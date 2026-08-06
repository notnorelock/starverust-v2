// @ts-check
const ts = require('typescript');

/**
 * Post-Terser hex/octal rewrite pass for numeric-literal TEXT — same architecture as
 * escapeStringLiterals() in obfuscate-strings.cjs (see that file's own doc comment for the
 * full "why post-Terser, why a text-splice pass over a re-parsed source rather than a
 * ts-loader `before` transformer" story; the short version carries over unchanged here:
 * Terser's printer unconditionally re-normalizes every numeric literal to its own canonical
 * decimal form on emit, verified directly — `0x1a` and `0o17` both print back out as `26`
 * and `15` even with compress/mangle disabled — so rewriting before Terser runs would be
 * silently undone by the time the final bundle is written).
 *
 * Every eligible NumericLiteral is rewritten to an equivalent hexadecimal (`0x...`) or octal
 * (`0o...`) form — see buildReplacement()/toRandomRadixLiteral() for the exact output shape,
 * which composes two independent transformations: (1) zero-padding each operand's digits to
 * a fixed minimum width (HEX_PAD_WIDTH/OCTAL_PAD_WIDTH) so even a small value like `1` prints
 * long, and (2) splitting the value into two operands that sum back to it and wrapping them
 * in a parenthesized `(a+b)` expression — `26` becomes something like
 * `(0x00000005+0o000000000025)`, not a single bare literal. Both transformations are purely
 * cosmetic and value-preserving (the JS grammar guarantees `0x1a === 26 === 0o32`, and
 * addition is exact for every value this module accepts — see splitOperands()'s own doc
 * comment for why `+` was chosen over a bitwise operator), so — same ceiling already stated
 * for every other cosmetic pass in this obfuscation system — this defeats a literal-text
 * grep for a specific decimal constant in the shipped bundle source, nothing more; a
 * breakpoint, console.log, or any real JS parser shows the exact same number immediately,
 * and evaluating the `(a+b)` expression is a single trivial addition, not an obstacle.
 * One exception to the `(a+b)` wrapping: a numeric literal used directly as an object/class
 * property or method KEY (`{5: 1}`, `class { 5() {} }`) cannot be replaced with an arbitrary
 * expression there — the grammar requires a single literal token in that position — so those
 * get only the zero-padding transformation, no split/parens; see
 * isUnwrappablePropertyKey().
 *
 * ONLY non-negative integer literals are eligible. Both `0x`/`0o` literal syntax are
 * integer-only in JS grammar — there is no hex/octal spelling of a fractional value
 * (`0x1.5` is a syntax error), so anything whose decoded text contains a `.` (`3.14`, and
 * `.5`, which TypeScript's parser normalizes to text `"0.5"`) is left as decimal,
 * unconditionally — see isEligibleInteger()'s own doc comment for why this is a single `.`
 * check, not a `.`/`e`/`E` check: TypeScript's NumericLiteral.text is the DECODED value, not
 * the original source spelling, so scientific notation like `1e10` has already been
 * normalized to the plain integer text `"10000000000"` by the time this code ever sees it —
 * verified directly — meaning such values ARE eligible and get converted like any other
 * integer, they just never need special-casing for the exponent marker since it's already
 * gone. Negative numbers are not a single NumericLiteral node in the first place — `-5`
 * parses as a PrefixUnaryExpression wrapping a NumericLiteral for `5` with a separate
 * MinusToken operator — so this pass naturally only ever touches the inner unsigned literal
 * and leaves the `-` alone, which already produces the correct `-0x5`/`-0o5` result without
 * any special-casing. Integers too large to round-trip exactly through `Number()` (anything
 * at or beyond Number.MAX_SAFE_INTEGER) are also skipped, to avoid ever emitting a hex/octal
 * literal whose parsed value silently differs from the original decimal text by a rounding
 * error — note this rounding can already happen at PARSE time for a source literal beyond
 * that threshold (verified: `9007199254740993` parses to NumericLiteral.text
 * `"9007199254740992"`, already rounded before this code runs at all), which is a pre-
 * existing JS number-precision fact this pass has no way to recover from, not something
 * introduced by this pass itself.
 *
 * `NaN`/`Infinity` are Identifier nodes in the AST (global property references), never
 * NumericLiteral, so they pass through this visitor untouched with no special-casing
 * needed. BigInt literals (`5n`) are a distinct SyntaxKind (BigIntLiteral) from
 * NumericLiteral and are not visited here — out of scope, and this codebase's own protocol/
 * physics code doesn't use BigInt today.
 */

/** Minimum digit-count knobs for padded operand output — small values still print this long, e.g. `0x00000000`. Purely cosmetic: extra leading zeros are insignificant in both radixes. */
const HEX_PAD_WIDTH = 8;
const OCTAL_PAD_WIDTH = 12;

/**
 * @param {number} value a non-negative integer (may exceed 32 bits — see splitOperands()'s
 *   own doc comment for why this function must tolerate that)
 * @param {boolean} isHex
 * @returns {string} `0x...`/`0o...` digits, zero-padded to at least HEX_PAD_WIDTH/
 *   OCTAL_PAD_WIDTH characters (never truncated shorter — a value whose natural digit count
 *   already exceeds the pad width simply prints at its natural, longer length).
 */
function toPaddedRadixDigits(value, isHex) {
  const width = isHex ? HEX_PAD_WIDTH : OCTAL_PAD_WIDTH;
  return value.toString(isHex ? 16 : 8).padStart(width, '0');
}

/**
 * Splits `value` into two non-negative operands `[a, b]` such that `a + b === value`, used
 * to wrap a numeric literal in an inert `(a+b)` expression instead of emitting it as one
 * bare literal. Addition, not XOR/bitwise ops, is the operator here specifically because
 * `^`/`|`/`&`/`<<`/`>>` all coerce their operands through ToInt32 in JS — silently
 * truncating any value outside the signed-32-bit range (-2^31 to 2^31-1) — while this
 * module already allows any value up to Number.MAX_SAFE_INTEGER (2^53-1, see
 * isEligibleInteger()); a bitwise split would silently corrupt any literal larger than
 * ~2.1 billion. Addition has no such range limit within the safe-integer range, so it's the
 * only arithmetic operator here that's correct for every value this module accepts, not
 * just the small ones a spot-check would happen to catch.
 * @param {number} value
 * @param {() => number} random
 * @returns {[number, number]}
 */
function splitOperands(value, random) {
  const a = Math.floor(random() * (value + 1));
  return [a, value - a];
}

/**
 * @param {number} value a non-negative safe integer
 * @param {() => number} random
 * @param {boolean} [wrapInParens] default true. When false, emits a SINGLE padded hex/octal
 *   literal token with no `+`-split/parens — required for a numeric PROPERTY KEY position
 *   (see isUnwrappablePropertyKey()), where the grammar demands one literal token, not an
 *   arbitrary expression; a computed key needs `[...]` brackets around an expression, but a
 *   non-computed numeric key like `{5: 1}`'s `5` cannot be `(a+b)` no matter how it's
 *   parenthesized — only the padding transformation applies there, not the split/wrap one.
 * @returns {string} a value-preserving replacement — see buildReplacement()'s own doc
 *   comment for the exact composition (radix choice, zero-padding, inert-`+`-expression
 *   wrapping) when `wrapInParens` is true.
 */
function toRandomRadixLiteral(value, random, wrapInParens = true) {
  if (!wrapInParens) {
    const isHex = random() < 0.5;
    return (isHex ? '0x' : '0o') + toPaddedRadixDigits(value, isHex);
  }
  return buildReplacement(value, random);
}

/**
 * Builds the actual replacement text for one eligible numeric literal: splits it into two
 * operands that sum back to the original value (see splitOperands()), picks hex or octal
 * PER OPERAND independently (so a single replacement can legitimately mix bases — e.g.
 * `(0x0000002a+0o000000000017)`), zero-pads each operand's digits, and wraps the pair in a
 * parenthesized `+` expression. The parens are required, not cosmetic: this is a
 * text-splice pass (see the module doc comment) substituting into whatever expression
 * position the original bare literal occupied, and `a+b` un-parenthesized could silently
 * change operator-precedence grouping relative to surrounding code (e.g. inside a larger
 * `*`/`%` expression, or adjacent to a `-` where `a+b-c` vs `(a+b)-c` happen to agree but a
 * different surrounding operator might not) — wrapping in `(...)` makes the replacement's
 * precedence behave exactly like the single literal it replaces, regardless of context. Only
 * called when the caller has already confirmed an arbitrary expression is legal at this
 * position (see toRandomRadixLiteral's `wrapInParens` parameter and
 * isUnwrappablePropertyKey()) — never for a property/method key.
 * @param {number} value
 * @param {() => number} random
 * @returns {string}
 */
function buildReplacement(value, random) {
  const [a, b] = splitOperands(value, random);
  const operand = (/** @type {number} */ n) => {
    const isHex = random() < 0.5;
    const prefix = isHex ? '0x' : '0o';
    return prefix + toPaddedRadixDigits(n, isHex);
  };
  return `(${operand(a)}+${operand(b)})`;
}

/**
 * @param {import('typescript').NumericLiteral} node
 * @returns {boolean} true if `node`'s decoded numeric value is a non-negative safe integer
 *   eligible for hex/octal rewriting — see the module doc comment for the full exclusion
 *   list (fractional, exponential, unsafe-magnitude values).
 */
function isEligibleInteger(node) {
  // node.text is ALWAYS the decoded decimal value, regardless of how the literal was
  // originally written — verified directly: `0x1a` in source parses to a NumericLiteral
  // whose .text is "26", not "0x1a", and `1e10` parses to .text "10000000000", not "1e10".
  // TypeScript's parser normalizes the text field itself; it is not the raw source
  // substring. This is why no "already hex/octal" pre-check is needed or possible from
  // .text alone — by the time this pass runs (post-Terser, on already-minified/normalized
  // output) every numeric literal has been printed back out as plain decimal digits
  // anyway, so there is nothing already-hex to detect in practice.
  //
  // Because .text is always plain decimal digits for an integer, a literal decimal point
  // (`.`) is sufficient to exclude fractional values (`3.14`, `.5` -> text "0.5") — no
  // `e`/`E` check is needed despite scientific notation being legal source syntax, since the
  // PARSED text for something like `1e10` is already the plain integer "10000000000" with
  // no exponent marker surviving into .text at all (verified directly). This means large
  // exponential integers like `1e10` ARE eligible and will be hex/octal-converted — there is
  // no separate "leave scientific notation alone" behavior, since by the time this code sees
  // it, it's indistinguishable from a plain integer literal.
  if (node.text.includes('.')) {
    return false;
  }
  const value = Number(node.text);
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {import('typescript').NumericLiteral} node
 * @returns {boolean} true if `node` is a numeric literal used directly as a property/method
 *   KEY — `{5: 1}`, `class { 5 = 1 }`, `class { 5() {} }`, `{ get 5() {} }`, `{ set 5(v) {} }`
 *   — a position where a bare NumericLiteral token is syntactically required and a
 *   parenthesized expression is NOT legal (a computed key needs `[...]` brackets around an
 *   expression; a non-computed numeric key must be the literal token itself). Verified
 *   directly against each of PropertyAssignment/PropertyDeclaration/MethodDeclaration/
 *   GetAccessorDeclaration/SetAccessorDeclaration: for all of these, `.name === node` means
 *   `node` IS the key (as opposed to, e.g., a PropertyAssignment's `.initializer`, which is
 *   an ordinary expression position where wrapping is fine). A key in this position still
 *   gets zero-padded digits (see buildReplacement()'s `wrapInParens` parameter) — just never
 *   the `(a+b)` expression wrapping, since that's what would break the syntax.
 */
function isUnwrappablePropertyKey(node) {
  const p = node.parent;
  if (!p) {
    return false;
  }
  if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
    return p.name === node;
  }
  if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) {
    return p.name === node;
  }
  return false;
}

/**
 * Rewrites every eligible NumericLiteral's source text in `jsText` to a random hex/octal
 * literal.
 * @param {string} jsText emitted JavaScript source (post-Terser, already minified)
 * @param {string} fileName only used for diagnostics inside the re-parse; not read from disk
 * @param {() => number} [random] injectable RNG, defaults to Math.random — same pattern as
 *   obfuscate-properties.cjs's generateDecoyFields() for testability, though this module has
 *   no test of its own today.
 * @returns {string}
 */
function obfuscateNumericLiterals(jsText, fileName, random = Math.random) {
  // setParentNodes MUST be true — isUnwrappablePropertyKey() below reads node.parent, and
  // ts.createSourceFile leaves .parent undefined on every node unless this flag is set. This
  // was caught the hard way: an earlier version passed `false` here (copied from
  // obfuscate-strings.cjs, which has this identical bug — see that file's own fix), which
  // made isUnwrappablePropertyKey() ALWAYS return false (its very first check is `if
  // (!node.parent) return false`), so every property/method numeric key got wrapped in an
  // `(a+b)` expression — syntactically invalid there — producing a bundle that failed to
  // parse in the browser. Always verify a flag like this against the actual .d.ts parameter
  // name/position rather than copying a call site that happened to not need it.
  const sourceFile = ts.createSourceFile(fileName, jsText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  /** @type {{ start: number, end: number, replacement: string }[]} */
  const edits = [];

  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isNumericLiteral(node) && isEligibleInteger(node)) {
      const value = Number(node.text);
      const wrapInParens = !isUnwrappablePropertyKey(node);
      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        replacement: toRandomRadixLiteral(value, random, wrapInParens),
      });
      // A NumericLiteral has no children worth descending into (its text is a leaf value).
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (edits.length === 0) {
    return jsText;
  }

  // Apply back-to-front so each earlier edit's (start, end) offsets stay valid as later
  // (numerically earlier) edits are spliced in — identical ordering concern to
  // escapeStringLiterals()'s own multi-edit splice loop in obfuscate-strings.cjs.
  edits.sort((a, b) => b.start - a.start);
  let result = jsText;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

module.exports = { obfuscateNumericLiterals, toRandomRadixLiteral };
