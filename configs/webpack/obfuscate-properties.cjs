// @ts-check
const path = require('node:path');
const ts = require('typescript');

/**
 * Runtime-indirection property obfuscator, run as a ts-loader custom transformer (see
 * webpack.prod.js's `getCustomTransformers` option) — NOT part of Terser's own
 * mangle.properties (see that option's own comment in webpack.prod.js for what it already
 * does: renaming every own property/method to a short token like `.a`/`.b`). That mangling
 * still leaves a *static* token at every access site, which is exactly what an automated
 * AST-based deobfuscator/renamer keys off of (usage-pattern analysis across `.a`/`.b`/`.c`
 * can often recover semantic groupings even without the original names). This transform
 * removes that static token entirely: every property/method NAME this repo itself declares
 * (see createScopeChecker() below), PLUS DOM/Web API property NAMES accessed from within
 * that same in-scope source (see createDomPropChecker() below — reads/writes of the real
 * DOM name, not a rename of it, since that's structurally impossible for a browser-defined
 * property), are replaced by a computed lookup into a runtime-decoded string table, so there
 * is no property-name identifier for a static analyzer to read at all — `obj.foo` becomes
 * `obj[$T(3)]`, and `$T(3)` only evaluates to a string once actual code executes.
 *
 * Ceiling, stated plainly (matching this project's own honesty about PacketFraming's XOR):
 * this defeats STATIC analysis of the shipped bundle. It does not and cannot hide anything
 * from someone willing to set a breakpoint and read the decoded table at runtime — same
 * threat model as the wire-protocol XOR already documented in
 * packages/protocol/src/security/PacketFraming.ts.
 *
 * Runs BEFORE Terser (ts-loader transforms happen at compile time, Terser runs at the very
 * end of the webpack optimize phase) — Terser's own mangle.properties then further shortens
 * the injected table-accessor identifiers themselves. Its `properties.reserved` list
 * (domprops.cjs/solid-delegated-events.cjs) still does real work downstream of this
 * transform: Terser's pass renames property IDENTIFIERS wherever it finds them (declaration
 * AND access sites both, anywhere in the bundle, including node_modules/SolidJS internals
 * this transform never touches), so it still needs domprops.cjs to avoid renaming e.g.
 * `.style`. This transform's own (separate) reuse of that same list, via
 * createDomPropChecker(), only ever turns a matching NAME into a computed lookup at an
 * access site already inside our own in-scope source — it never renames anything and never
 * touches solid-delegated-events.cjs's convention-based names, which aren't real DOM
 * properties and stay out of scope here.
 *
 * Table scope is PER FILE, not one shared table for the whole program: ts-loader's `before`
 * transformers run once per source file, and coordinating a single cross-file table would
 * require either a shared virtual module (extra webpack resolver machinery) or a "carrier
 * file" convention (fragile — breaks if that file is ever tree-shaken). Since each
 * transformed file gets its OWN locally-scoped decode function and its OWN local table (see
 * obfuscate-properties.transformer.cjs's per-file table injection), index 3 in file A and
 * index 3 in file B can safely decode to different names — there's no cross-file coupling to
 * get wrong. The only cost is some duplicated numeric-array literals across files, which
 * Terser's own dedup/compression passes shrink further downstream anyway.
 */

/**
 * A name is only ever rewritten via this checker if the TypeScript type-checker can resolve
 * it to a declaration whose source file lives under one of these roots — DOM lib types,
 * WebSocket, CanvasRenderingContext2D, node_modules (SolidJS, Kysely, etc.) all resolve
 * outside these roots and are left untouched BY THIS CHECK. This is the safety boundary for
 * our own declared names, in place of a hand-maintained reserved list. DOM/Web API property
 * NAMES specifically get a second, independent inclusion path instead — see
 * createDomPropChecker() below, which does reuse domprops.cjs (Terser's own exclusion list
 * for the opposite direction, "these must never be RENAMED") as a positive membership check
 * for "these may still become a computed lookup, same literal name, at an access site
 * already in scope."
 * @param {string[]} packageRoots absolute paths, e.g. [".../packages/shared/src", ".../packages/client/src"]
 */
function createScopeChecker(packageRoots) {
  const normalizedRoots = packageRoots.map((root) => path.resolve(root) + path.sep);
  return (/** @type {string} */ fileName) => {
    const resolved = path.resolve(fileName);
    return normalizedRoots.some((root) => resolved.startsWith(root));
  };
}

/**
 * Membership check for DOM/Web API property names (domprops.cjs — Terser's OWN
 * mangle.properties.reserved list, see webpack.prod.js), reused here for the opposite
 * purpose: those names can never be RENAMED (they're real browser API contracts — `.style`,
 * `.addEventListener`, canvas context methods, etc. — a cheat reading devtools/breakpoints
 * sees the real DOM regardless of what our source calls it), but a `PropertyAccessExpression`
 * in OUR OWN source that reads/writes one is still eligible to become a computed `$T(i)`
 * lookup — same runtime property name, just no static string identifier sitting in the
 * shipped bundle for someone reading the source (not devtools) to grep for. This is
 * deliberately name-based, not declaration-based like createScopeChecker(): a DOM property's
 * declaration lives in TypeScript's lib.dom.d.ts, entirely outside any package root, so it
 * could never satisfy createScopeChecker's file-location check in the first place — this is
 * an independent, additive eligibility path (see createObfuscationTransformer's isDomProp
 * parameter), not a replacement for it.
 *
 * ONLY ever consulted for PropertyAccessExpression (a value being read/written via
 * `obj.foo`) — never for a declaration site (class field/method, object-literal key,
 * destructuring binding). A same-named local declaration (e.g. our own class happening to
 * have a field called `style`) must keep going through the normal in-scope symbol check;
 * matching this list at a declaration site would be wrong (there's no DOM property being
 * declared) and is never invoked that way.
 * @param {string[]} names domprops.cjs's own default export
 */
function createDomPropChecker(names) {
  const set = new Set(names);
  return (/** @type {string} */ name) => set.has(name);
}

const DECODE_FN_IDENTIFIER = '__starve_obf_get';
const KEY_IDENTIFIER = '__starve_obf_key';
const TABLE_IDENTIFIER = '__starve_obf_table';
const CACHE_IDENTIFIER = '__starve_obf_cache';

/**
 * Builds one file's self-contained XOR-encoded table + decode function as real ts.Statement
 * nodes constructed directly via the factory — NOT as source text to be re-parsed and
 * spliced in via a second ts.createSourceFile() call. That was the first implementation and
 * it corrupted the emitted bundle: nodes from a separately-parsed SourceFile carry real
 * (pos, end) text-range offsets into THEIR OWN source string, and when spliced into a
 * different file's statement list, TypeScript's printer can take a "fast path" that slices
 * substrings directly out of a cached source-text buffer using stale positions rather than
 * regenerating text from the node structure — so the printed output ended up interleaving
 * fragments of the WRONG file's source text. Building nodes via ts.factory instead means
 * every node is synthetic (no pos/end), which forces the printer to always fully regenerate
 * text from the node tree, sidestepping the whole class of bug.
 *
 * @param {import('typescript').NodeFactory} factory
 * @param {string[]} names deduplicated, in stable index order for this file
 * @returns {import('typescript').Statement[]}
 */
function buildEncodedTableStatements(factory, names) {
  // A fresh random key per FILE (not even per build) — every name within one file is encoded
  // against that file's own key, decoded lazily (memoized per index) the first time each
  // property is actually accessed. Regenerating per file means the same source producing two
  // different builds never yields byte-identical obfuscated output, and no single key
  // recovery anywhere in the bundle helps decode any other file's table.
  const key = 1 + Math.floor(Math.random() * 250); // avoid 0 (no-op XOR) and stay in one byte

  // Each name becomes an array-literal of NumericLiteral charcodes (not a string literal!)
  // so the plaintext name never appears anywhere in the emitted source at all, XOR-obfuscated
  // or not — a string search for e.g. "sendChatMessage" across the bundle finds nothing,
  // since the only representation on disk is a list of numbers.
  const tableLiteral = factory.createArrayLiteralExpression(
    names.map((name) =>
      factory.createArrayLiteralExpression(
        Array.from(name).map((ch) => factory.createNumericLiteral(ch.charCodeAt(0) ^ key)),
      ),
    ),
  );

  const keyDecl = varStatement(factory, KEY_IDENTIFIER, factory.createNumericLiteral(key));
  const tableDecl = varStatement(factory, TABLE_IDENTIFIER, tableLiteral);
  const cacheDecl = varStatement(
    factory,
    CACHE_IDENTIFIER,
    factory.createNewExpression(factory.createIdentifier('Array'), undefined, [
      factory.createPropertyAccessExpression(factory.createIdentifier(TABLE_IDENTIFIER), 'length'),
    ]),
  );

  // function __starve_obf_get(i) {
  //   var v = __starve_obf_cache[i];
  //   if (v !== undefined) return v;
  //   var codes = __starve_obf_table[i];
  //   var s = '';
  //   for (var j = 0; j < codes.length; j++) s += String.fromCharCode(codes[j] ^ __starve_obf_key);
  //   __starve_obf_cache[i] = s;
  //   return s;
  // }
  const i = factory.createIdentifier('i');
  const v = factory.createIdentifier('v');
  const codes = factory.createIdentifier('codes');
  const s = factory.createIdentifier('s');
  const j = factory.createIdentifier('j');

  const decodeFn = factory.createFunctionDeclaration(
    undefined,
    undefined,
    factory.createIdentifier(DECODE_FN_IDENTIFIER),
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, i)],
    undefined,
    factory.createBlock(
      [
        varStatement(factory, v.text, factory.createElementAccessExpression(factory.createIdentifier(CACHE_IDENTIFIER), i)),
        factory.createIfStatement(
          factory.createBinaryExpression(v, ts.SyntaxKind.ExclamationEqualsEqualsToken, factory.createIdentifier('undefined')),
          factory.createReturnStatement(v),
        ),
        varStatement(factory, codes.text, factory.createElementAccessExpression(factory.createIdentifier(TABLE_IDENTIFIER), i)),
        varStatement(factory, s.text, factory.createStringLiteral('')),
        factory.createForStatement(
          factory.createVariableDeclarationList(
            [factory.createVariableDeclaration(j, undefined, undefined, factory.createNumericLiteral(0))],
            ts.NodeFlags.None,
          ),
          factory.createBinaryExpression(j, ts.SyntaxKind.LessThanToken, factory.createPropertyAccessExpression(codes, 'length')),
          factory.createPostfixIncrement(j),
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              s,
              ts.SyntaxKind.PlusEqualsToken,
              factory.createCallExpression(
                factory.createPropertyAccessExpression(factory.createIdentifier('String'), 'fromCharCode'),
                undefined,
                [
                  factory.createBinaryExpression(
                    factory.createElementAccessExpression(codes, j),
                    ts.SyntaxKind.CaretToken,
                    factory.createIdentifier(KEY_IDENTIFIER),
                  ),
                ],
              ),
            ),
          ),
        ),
        factory.createExpressionStatement(
          factory.createBinaryExpression(
            factory.createElementAccessExpression(factory.createIdentifier(CACHE_IDENTIFIER), i),
            ts.SyntaxKind.EqualsToken,
            s,
          ),
        ),
        factory.createReturnStatement(s),
      ],
      true,
    ),
  );

  return [keyDecl, tableDecl, cacheDecl, decodeFn];
}

/** @type {(factory: import('typescript').NodeFactory, name: string, initializer: import('typescript').Expression) => import('typescript').VariableStatement} */
function varStatement(factory, name, initializer) {
  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(factory.createIdentifier(name), undefined, undefined, initializer)],
      ts.NodeFlags.None,
    ),
  );
}

/**
 * Registry scoped to ONE file's transform pass — collects every unique eligible name that
 * file's AST visit rewrites, in first-seen order, so buildEncodedTableStatements() can
 * assign each a stable index matching the $T(i) calls the transformer already emitted.
 */
class NameRegistry {
  constructor() {
    /** @type {Map<string, number>} */
    this.indexByName = new Map();
  }

  indexFor(/** @type {string} */ name) {
    let index = this.indexByName.get(name);
    if (index === undefined) {
      index = this.indexByName.size;
      this.indexByName.set(name, index);
    }
    return index;
  }

  names() {
    return [...this.indexByName.keys()];
  }
}

module.exports = {
  createScopeChecker,
  createDomPropChecker,
  buildEncodedTableStatements,
  NameRegistry,
  DECODE_FN_IDENTIFIER,
};
