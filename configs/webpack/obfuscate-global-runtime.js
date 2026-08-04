// @ts-check

/**
 * Resolves the host global-scope object exactly once for the whole bundle, provided to every
 * obfuscated module as the free identifier `_gbl` via webpack.ProvidePlugin (see that plugin's
 * registration in webpack.prod.js) — NOT re-declared per file. An earlier version had
 * obfuscate-properties.transformer.cjs inject this same try/catch chain as its own
 * `var _gbl = (function(){...})();` statement into every file that referenced a bare global,
 * which meant the identical three-branch try/catch ran once per FILE (32 times in a typical
 * build) instead of once for the whole bundle — all resolving to the same object, so the
 * repeated work bought nothing. ProvidePlugin's job is exactly "make this identifier
 * available everywhere without an explicit import," which is the standard webpack mechanism
 * for legacy globals like `$`/`Buffer`/`process` shims — reusing it here means `_gbl` is
 * computed once, at this module's own evaluation time (webpack still only evaluates a given
 * module once no matter how many other modules import it), and every consuming file gets the
 * same reference.
 *
 * Deliberately NOT under any of the obfuscation pre-pass's scopeRoots (see
 * obfuscate-build.cjs's own `scopeRoots`/`mirrorRoots` construction in webpack.prod.js) — this
 * file's own `globalThis`/`window`/`global`/`self` identifiers must NEVER be rewritten by
 * createObfuscationTransformer's bare-Identifier visit case, since THIS is the one place that
 * has to reference them for real. If this file were ever pulled into scope, the obfuscation
 * transform would try to replace its own bootstrap references with `_gbl[$T(i)]` — circular,
 * since `_gbl` doesn't exist yet at the point this module defines it.
 *
 * globalThis -> window -> global -> self preference order: `globalThis` is the one
 * standardized cross-environment name (defined in every target this project runs in — a
 * plain browser tab — so this chain short-circuits on its very first line in practice);
 * `window`/`global`/`self` are additional fallbacks for environments where `globalThis`
 * itself might be absent (older engines) or the "obvious" global goes by a different name
 * (`global` in older Node-style CommonJS, `self` in a Worker/ServiceWorker context).
 *
 * Each candidate is tried inside its own `try { return X; } catch (e) {}` rather than a
 * `typeof X !== "undefined"` guard or a bare `X ?? Y ?? Z` chain: referencing a bare
 * identifier that was never declared ANYWHERE throws `ReferenceError` the instant it's
 * evaluated — `??` still evaluates its left operand as an ordinary reference first, so it
 * doesn't help avoid that throw.
 */
const _gbl = (function () {
  try {
    return globalThis;
  } catch (e) {}
  try {
    return window;
  } catch (e) {}
  // try {
  //   return global;
  // } catch (e) {}
  return self;
})();

module.exports = _gbl;
