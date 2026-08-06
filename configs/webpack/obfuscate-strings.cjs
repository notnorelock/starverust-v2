// @ts-check
const ts = require('typescript');

/**
 * Post-emit \x/\u escape pass for string-literal TEXT, run once per emitted .js file
 * immediately after obfuscate-build.cjs's TypeScript emit (see that file's own call site) —
 * a completely separate mechanism from obfuscate-properties.cjs's runtime-decode-table
 * approach, and deliberately a much weaker one. Every character of every eligible string
 * literal is rewritten to its `\xNN` (code point <= 0xff) or `\uNNNN` (code point > 0xff)
 * escape sequence — `"foo"` becomes `"\x66\x6f\x6f"`. This is IDENTICAL to the original
 * string at parse time (JS engines decode escape sequences during lexing, before any code
 * runs), so this defeats nothing beyond a literal-text grep/search across the shipped
 * bundle: console.log-ing the value, setting a breakpoint, or running the bundle through
 * any real JS parser (prettier, an unminifier, the browser's own "pretty print" devtools
 * button) all show the exact plaintext immediately. This is a strictly weaker guarantee
 * than obfuscate-properties.cjs's property-name table (which requires actually running the
 * decode function, not just parsing) — string literals don't get that treatment here
 * because turning a string VALUE into a runtime-computed expression everywhere one is used
 * as a literal (template default, switch-case label, object key needing a compile-time
 * constant, etc.) is a much larger structural change than a property accessor rewrite, and
 * wasn't what was asked for. If stronger string protection is ever wanted, the same
 * per-file XOR-table approach already built for properties (see
 * obfuscate-properties.cjs/obfuscate-properties.transformer.cjs) is the pattern to extend,
 * not this one.
 *
 * Operates as a POST-EMIT TEXT PASS over the already-emitted .js (re-parsed as plain JS via
 * ts.createSourceFile), not a ts-loader `before` transformer over the original .ts AST like
 * obfuscate-properties.transformer.cjs. This is deliberate, not an oversight: TypeScript's
 * printer always re-derives a StringLiteral's printed escaping from its decoded `.text`
 * property — there is no supported way to hand the printer a pre-built literal-syntax
 * string (e.g. `\x66\x6f\x6f`) and have it emitted verbatim; a synthetic node's `rawText`
 * field is not honored by ts.createPrinter() (verified directly: setting it has no effect
 * on output). Splicing edits into the emitted TEXT by each node's real (pos, end) instead
 * sidesteps that entirely, and is safe here in a way it was NOT for
 * obfuscate-properties.cjs's own table-statement injection (see that file's
 * buildEncodedTableStatements() doc comment for why splicing real positions across
 * DIFFERENT files corrupts output) — this pass never moves a node's text to a different
 * file or a different position, it only replaces one string literal's own source range with
 * new text of the same kind, in the same file, so there is no cross-file position
 * collision to create.
 *
 * What is deliberately left untouched, and why:
 *   - Template literals (`` `...` ``, both NoSubstitutionTemplateLiteral and
 *     TemplateExpression) — a distinct AST node kind from StringLiteral, never visited here.
 *     Escaping one wouldn't hide anything additional since template contents/expressions
 *     are already visible as code, not as an opaque literal.
 *   - Regex literals — a distinct node kind, not string data at all.
 *   - Import/export module specifiers (`import { x } from './module'`) and dynamic
 *     `import('./module')` call arguments — these ARE StringLiteral nodes syntactically,
 *     but this pass runs on the .js TypeScript emits BEFORE webpack's own module resolution
 *     reads that text; escaping one would still be spec-legal JS, but there is no
 *     obfuscation value in hiding a specifier list that's already fully recoverable from
 *     webpack's own emitted chunk/module structure, so they're explicitly skipped rather
 *     than escaped for no benefit.
 *   - Any string produced BY obfuscate-properties.cjs's own transformer (the property
 *     decode table) — that code represents names as numeric char-code arrays, never as
 *     string literals in the first place (see that file's own doc comment), so there is
 *     nothing here for this pass to interact with or double-encode.
 */

/**
 * @param {string} value decoded string content (e.g. `foo` from `"foo"`)
 * @returns {string} literal-syntax escape sequences only — e.g. `\x66\x6f\x6f`
 */
function toEscapedLiteralText(value) {
  let out = '';
  for (const char of value) {
    const codePoint = /** @type {number} */ (char.codePointAt(0));
    if (codePoint > 0xffff) {
      // Astral code point — re-escape each UTF-16 surrogate unit individually, since \u only
      // encodes a single 16-bit unit and \x only a single byte; iterating `char` (not
      // `value`) already gave us one full code point per loop turn via for-of's code-point
      // iteration, so decompose it back to code units here for the actual escape output.
      for (const unit of char) {
        out += '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0');
      }
    } else if (codePoint > 0xff) {
      out += '\\u' + codePoint.toString(16).padStart(4, '0');
    } else {
      out += '\\x' + codePoint.toString(16).padStart(2, '0');
    }
  }
  return out;
}

/**
 * @param {import('typescript').Node} node
 * @returns {boolean} true if `node` is a StringLiteral used as a module specifier (import/
 *   export declaration or dynamic import() call argument) — see the module doc comment for
 *   why these are skipped.
 */
function isModuleSpecifier(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) {
    return true;
  }
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }
  return false;
}

/**
 * Rewrites every eligible StringLiteral's source text in `jsText` to \x/\u escape sequences.
 * @param {string} jsText emitted JavaScript source (post ts.Program.emit(), pre-Terser)
 * @param {string} fileName only used for diagnostics inside the re-parse; not read from disk
 * @returns {string}
 */
function escapeStringLiterals(jsText, fileName) {
  // setParentNodes MUST be true — isModuleSpecifier() below reads node.parent, and
  // ts.createSourceFile leaves .parent undefined on every node unless this flag is set. A
  // previous version of this function (and obfuscate-numbers.cjs, copied from here) passed
  // `false`, which made isModuleSpecifier() ALWAYS return false (its first check is `if
  // (!parent) return false`) — meaning import/export specifier strings were never actually
  // exempted despite this file's own doc comment claiming they were. In THIS module the
  // practical blast radius was limited (escaping an already-resolved specifier string is
  // spec-legal JS, just pointless per the doc comment's own reasoning, not a syntax error),
  // but the identical bug in obfuscate-numbers.cjs's analogous property-key check DID
  // produce invalid syntax there, which is how this was caught — see that file's own fix
  // for the concrete failure.
  const sourceFile = ts.createSourceFile(fileName, jsText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  /** @type {{ start: number, end: number, replacement: string }[]} */
  const edits = [];

  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isStringLiteral(node) && !isModuleSpecifier(node)) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const quote = jsText[start];
      edits.push({ start, end, replacement: quote + toEscapedLiteralText(node.text) + quote });
      // A StringLiteral has no children worth descending into (its text is a leaf value),
      // so no ts.forEachChild call here — falling through to the loop's own return is fine.
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (edits.length === 0) {
    return jsText;
  }

  // Apply back-to-front so each earlier edit's (start, end) offsets stay valid as later
  // (numerically earlier) edits are spliced in — mirrors the same ordering concern as any
  // multi-edit text-splice pass over one immutable string.
  edits.sort((a, b) => b.start - a.start);
  let result = jsText;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

module.exports = { escapeStringLiterals, toEscapedLiteralText };
