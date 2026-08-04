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
 *
 * BARE GLOBAL IDENTIFIERS (`WebSocket`, `window`, `document`, `requestAnimationFrame`, ...)
 * get the same treatment through a second mechanism layered on top: see
 * isEligibleGlobalIdentifier() in obfuscate-properties.transformer.cjs. A bare identifier is
 * a different AST shape from a property access (`WebSocket` vs `obj.WebSocket`), so it can't
 * go through the `obj[$T(i)]` rewrite above directly — there is no `obj` to rewrite. Instead
 * every genuine bare-global reference (verified by the checker to resolve OUTSIDE every scope
 * root, never a local/shadowing declaration — see isEligibleGlobalIdentifier()'s own doc
 * comment) becomes `_gbl[$T(i)]`, reusing the SAME per-file `$T(i)` name table as property
 * names (no second XOR table — a global name has no different confidentiality need than a
 * property name). `new WebSocket(...)` becomes `new _gbl[$T(i)](...)`, `window.innerWidth`
 * becomes `_gbl[$T(j)].innerWidth` (the `.innerWidth` part is separately handled by the
 * existing DOM-prop property-access path above), and so on.
 *
 * `_gbl` ITSELF is NOT synthesized per file (an earlier version injected a `var _gbl =
 * (try/catch chain)` statement into every file that referenced a bare global, which meant the
 * identical three-branch try/catch ran once per FILE — 32 times in a typical build — all
 * resolving to the same object for no benefit). Instead `_gbl` is provided exactly once for
 * the whole bundle via `webpack.ProvidePlugin` (see its registration in webpack.prod.js),
 * pointing at obfuscate-global-runtime.js — a plain, never-obfuscated module (deliberately
 * outside every scopeRoots) that resolves the host global object once. Every obfuscated file
 * simply references the free identifier `_gbl`; webpack's ProvidePlugin auto-injects the
 * import for it, the same standard mechanism used for legacy `$`/`Buffer`/`process` shims.
 *
 * DECOY FIELDS AND METHODS (see generateDecoyFields()/generateDecoyMembers() below) inject
 * fake, never-real class members — including, as of generateDecoyMembers()'s bodyShapes,
 * fake CONTROL FLOW (if/else, switch) inside decoy method bodies. This is deliberately
 * scoped to ONLY decoy methods, never real ones: a decoy method's body is provably
 * self-contained (reads only this same decoy batch's own fields, calls nothing, writes
 * nothing), so an opaque/dead branch inside it can never diverge based on anything a real
 * caller does. Splicing opaque/dead branches into REAL method bodies (physics, rendering,
 * networking) was considered and rejected — this codebase has strict tick/ordering
 * invariants (see CLAUDE.md's PhysicsSystem/MovementSystem/CCD notes) that an AST-level
 * "this branch is unreachable" proof cannot reliably verify, and a wrong proof there ships
 * a real bug, not just weaker obfuscation.
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
const GLOBAL_OBJECT_IDENTIFIER = '_gbl';

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

/**
 * Decoy names are generated COMBINATORIALLY (prefix + suffix pairs), not picked from one
 * flat list — a flat list runs out at a handful of entries, but this transform needs to
 * support up to ~100 decoy fields/methods per class (see generateDecoyFields()'s own doc
 * comment for the count range). `DECOY_FIELD_PREFIXES` (12) × `DECOY_FIELD_SUFFIXES` (12)
 * gives 144 unique field-name combinations — comfortably above 100 — while every combination
 * still reads as a plausible game-state field name (`_hpRegen`, `_shieldSync`,
 * `_manaChecksum`, ...), styled the same as this codebase's own short lowerCamelCase naming.
 * Method names use a disjoint word-pair scheme for the same reason (see
 * DECOY_METHOD_VERBS/DECOY_METHOD_NOUNS below) — a method reads as a verb+noun action
 * (`regenerateShield`, `syncChecksum`) where a field reads as a noun/state alone, so mixing
 * the pools would produce an obviously-wrong shape like a field named `regenerate`.
 */
const DECOY_FIELD_PREFIXES = [
  '_hp',
  '_shield',
  '_stamina',
  '_mana',
  '_cooldown',
  '_armor',
  '_seed',
  '_epoch',
  '_buff',
  '_debug',
  '_sync',
  '_cache',
];
const DECOY_FIELD_SUFFIXES = [
  'Regen',
  'Sync',
  'Checksum',
  'Mask',
  'Token',
  'Rate',
  'Flag',
  'State',
  'Delta',
  'Cache',
  'Tick',
  'Ref',
];

/**
 * Builds a shuffled, deduplicated list of up to `count` unique names from the prefix x
 * suffix combinatorial space, excluding anything in `excludeNames` (case-sensitive, checked
 * against the exact combined name) — shared by generateDecoyFields() and the method-name
 * generation inside generateDecoyMembers() below, just parameterized by which two pools to
 * combine.
 * @param {() => number} random
 * @param {number} count
 * @param {Set<string>} excludeNames
 * @param {string[]} prefixes
 * @param {string[]} suffixes
 * @returns {string[]}
 */
function generateUniqueNames(random, count, excludeNames, prefixes, suffixes) {
  // Every prefix x suffix pair, e.g. "_hp" + "Regen" -> "_hpRegen" — built once per call
  // rather than cached at module scope, since exclusion (own+inherited real member names)
  // differs per class and filtering the combined list is cheap at this size (max 144
  // entries for the field pools above).
  const combined = [];
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      const name = prefix + suffix;
      if (!excludeNames.has(name)) {
        combined.push(name);
      }
    }
  }

  // Fisher-Yates shuffle using the injected RNG, then take the first `count` — this is what
  // makes both the SELECTED subset and its ORDER differ per class/build, rather than always
  // emitting the same names in the same prefix-major order.
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.slice(0, count);
}

/**
 * @param {() => number} random 0-inclusive/1-exclusive RNG, injected so callers can reuse
 *   the same per-file `Math.random` convention already used elsewhere in this module (e.g.
 *   buildEncodedTableStatements()'s per-file XOR key) rather than this function reaching for
 *   `Math.random()` directly.
 * @param {number} count how many decoy fields to generate for one class — the caller (see
 *   createObfuscationTransformer's ClassDeclaration visit case) rolls this per class in a
 *   ~60-100 range, not a fixed constant, so different classes in the same build carry
 *   different amounts of noise.
 * @param {Set<string>} excludeNames real member names already declared on this class (both
 *   original and post-obfuscation-irrelevant — this check happens against the PLAINTEXT
 *   name, before any $T(i) rewriting) — a decoy must never collide with a real field, or it
 *   would silently shadow/overwrite it at class-definition time.
 * @returns {{ name: string, value: import('typescript').Expression }[]} decoy name/value
 *   pairs, using ts.factory-free plain data (the VALUE is still a factory Expression since a
 *   literal needs the same factory instance the rest of the file's synthetic nodes use) —
 *   the caller is responsible for turning `name` into a computed $T(i) key via its own
 *   computedKeyFor(), same as every other rewritten name in this file.
 */
function generateDecoyFields(random, count, excludeNames) {
  const factory = ts.factory;
  const valueFactories = [
    () => factory.createNumericLiteral(Math.floor(random() * 1000)),
    () => (random() < 0.5 ? factory.createTrue() : factory.createFalse()),
    () => factory.createNumericLiteral((random() * 100).toFixed(2)),
    () => factory.createNull(),
  ];

  const names = generateUniqueNames(random, count, excludeNames, DECOY_FIELD_PREFIXES, DECOY_FIELD_SUFFIXES);
  return names.map((name) => ({
    name,
    value: valueFactories[Math.floor(random() * valueFactories.length)](),
  }));
}

/** Verb half of the decoy method name combinatorial space — see DECOY_FIELD_PREFIXES's own doc comment for why this is combinatorial rather than a flat list. */
const DECOY_METHOD_VERBS = ['regenerate', 'sync', 'validate', 'apply', 'reset', 'tick', 'refresh', 'compute', 'normalize', 'roll', 'clamp', 'resolve'];
/** Noun half — combined as verb+capitalized-noun, e.g. "regenerate" + "Shield" -> "regenerateShield". */
const DECOY_METHOD_NOUNS = ['Shield', 'Buff', 'Checksum', 'Cache', 'Delta', 'Seed', 'State', 'Flags', 'Cooldown', 'Token', 'Mask', 'Epoch'];

/**
 * Generates BOTH decoy fields and decoy methods for one class in a single call (rather than
 * two independent functions) specifically so a decoy method's body can safely reference a
 * decoy FIELD generated in the same batch — reading `this[<decoy field>]` inside a decoy
 * method makes the method look like a real accessor/utility instead of an obviously inert
 * stub returning only literals, while guaranteeing the field reference always resolves to
 * another fake, never-real field (never accidentally reading real game state).
 *
 * Decoy methods are pure and side-effect-free by construction: every body shape (see
 * bodyShapes below — a plain return, an if/else, or a switch) only ever READS this same
 * decoy batch's own fields and returns a value derived purely from them — never a loop,
 * never a call to anything else (no other method, no global, no `_gbl`), never a write to
 * anything, and never a reference to a REAL class member. Control flow (if/else, switch) IS
 * included here specifically because that self-contained guarantee makes it safe: a branch
 * condition built only from decoy state can never diverge based on anything a real caller
 * does, so there's no path-dependent behavior for opaque/dead-branch injection to get wrong.
 * This is a deliberately narrower scope than "add control flow to obfuscated code" — real
 * method bodies (physics, rendering, networking) are NEVER touched this way; see the module
 * doc comment's fake-control-flow discussion for why that boundary is load-bearing, not
 * arbitrary.
 *
 * @param {() => number} random see generateDecoyFields()'s own doc comment.
 * @param {number} fieldCount how many decoy fields to generate.
 * @param {number} methodCount how many decoy methods to generate (0 is valid — fields only).
 * @param {Set<string>} excludeNames real member names (own + inherited) already on this
 *   class — checked against BOTH the field and method name pools, since a decoy method and a
 *   real method colliding would silently override the real implementation, the same
 *   correctness concern as a colliding decoy field.
 * @param {(name: string) => import('typescript').Expression} computedKeyFor the SAME
 *   per-file $T(i) key-building closure the caller already uses for every other rewritten
 *   name in this file — required here so a decoy method's `this[<decoy field>]` read goes
 *   through the identical computed-lookup obfuscation as everything else, rather than
 *   leaking the decoy field's own name as a literal string at this one access site (which
 *   would defeat the point: the field's DECLARATION is a computed name, but a plaintext
 *   string read of it would still let a bundle-source grep find the name).
 * @returns {{
 *   fields: { name: string, value: import('typescript').Expression }[],
 *   methods: { name: string, body: import('typescript').Statement[] }[],
 * }}
 */
function generateDecoyMembers(random, fieldCount, methodCount, excludeNames, computedKeyFor) {
  const fields = generateDecoyFields(random, fieldCount, excludeNames);
  if (methodCount === 0 || fields.length === 0) {
    return { fields, methods: [] };
  }

  const factory = ts.factory;
  const fieldNamesUsed = new Set(fields.map((f) => f.name));
  const methodExcludeNames = new Set([...excludeNames, ...fieldNamesUsed]);
  const availableMethodNames = generateUniqueNames(
    random,
    methodCount,
    methodExcludeNames,
    DECOY_METHOD_VERBS,
    DECOY_METHOD_NOUNS,
  );

  /** @type {(name: string) => import('typescript').Expression} */
  const fieldReadFor = (name) => factory.createElementAccessExpression(factory.createThis(), computedKeyFor(name));

  const exprBuilders = [
    (/** @type {import('typescript').Expression} */ fieldRead) =>
      factory.createBinaryExpression(
        fieldRead,
        ts.SyntaxKind.PlusToken,
        factory.createNumericLiteral(Math.floor(random() * 10)),
      ),
    (/** @type {import('typescript').Expression} */ fieldRead) =>
      factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, fieldRead),
    (/** @type {import('typescript').Expression} */ fieldRead) =>
      factory.createBinaryExpression(fieldRead, ts.SyntaxKind.AmpersandAmpersandToken, factory.createTrue()),
  ];
  const randomExpr = (/** @type {import('typescript').Expression} */ fieldRead) =>
    exprBuilders[Math.floor(random() * exprBuilders.length)](fieldRead);

  /**
   * Body shape builders — every one of these ONLY ever reads fields already present in
   * `fields` (this same decoy batch, via fieldReadFor()/computedKeyFor()) and returns a
   * value derived purely from decoy state. None call another method (decoy or real), none
   * reference `_gbl`/any global, none touch a real class member — this is what makes
   * control flow here safe to add at all: a branch condition built only from decoy state
   * can never diverge based on anything a real caller does, so there's no path-dependent
   * behavior to get wrong the way it would be for a REAL method (see the module doc comment
   * for why real-method control-flow injection was deliberately rejected). Each shape takes
   * `pickedFields` — a small subset of `fields` reserved for this one method — and returns
   * a Statement[] body.
   *
   * @type {((pickedFields: { name: string }[]) => import('typescript').Statement[])[]}
   */
  const bodyShapes = [
    // return <expr>;
    (pickedFields) => [factory.createReturnStatement(randomExpr(fieldReadFor(pickedFields[0].name)))],

    // if (<cond>) { return <exprA>; } else { return <exprB>; }
    (pickedFields) =>
      [
        factory.createIfStatement(
          randomExpr(fieldReadFor(pickedFields[0].name)),
          factory.createBlock(
            [factory.createReturnStatement(randomExpr(fieldReadFor(pickedFields[1 % pickedFields.length].name)))],
            true,
          ),
          factory.createBlock(
            [factory.createReturnStatement(randomExpr(fieldReadFor(pickedFields[2 % pickedFields.length].name)))],
            true,
          ),
        ),
      ],

    // switch (this[<decoy>] ? 1 : 0) { case 1: return <exprA>; default: return <exprB>; }
    // The discriminant is coerced to a fixed 0/1 via the ternary specifically so the case
    // labels can be plain numeric literals (a `switch` case label must be a literal, not an
    // arbitrary expression) without this generator needing to know any decoy field's exact
    // runtime value at codegen time — the field itself still drives which branch executes.
    (pickedFields) => [
      factory.createSwitchStatement(
        factory.createConditionalExpression(
          fieldReadFor(pickedFields[0].name),
          undefined,
          factory.createNumericLiteral(1),
          undefined,
          factory.createNumericLiteral(0),
        ),
        factory.createCaseBlock([
          factory.createCaseClause(factory.createNumericLiteral(1), [
            factory.createReturnStatement(randomExpr(fieldReadFor(pickedFields[1 % pickedFields.length].name))),
          ]),
          factory.createDefaultClause([
            factory.createReturnStatement(randomExpr(fieldReadFor(pickedFields[2 % pickedFields.length].name))),
          ]),
        ]),
      ),
    ],
  ];

  const methods = availableMethodNames.map((name) => {
    // Reserve up to 3 distinct decoy fields for this method's body (fewer if the batch is
    // small — bodyShapes' own `% pickedFields.length` indexing degrades gracefully down to
    // a single field being reused across branches when fields.length < 3).
    const pickedFields = [];
    const poolCopy = [...fields];
    for (let i = 0; i < Math.min(3, poolCopy.length); i++) {
      const index = Math.floor(random() * poolCopy.length);
      pickedFields.push(poolCopy.splice(index, 1)[0]);
    }
    const shape = bodyShapes[Math.floor(random() * bodyShapes.length)];
    return { name, body: shape(pickedFields) };
  });

  return { fields, methods };
}

module.exports = {
  createScopeChecker,
  createDomPropChecker,
  buildEncodedTableStatements,
  generateDecoyFields,
  generateDecoyMembers,
  NameRegistry,
  DECODE_FN_IDENTIFIER,
  GLOBAL_OBJECT_IDENTIFIER,
};
