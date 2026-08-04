// @ts-check
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const webpack = require('webpack');
const { merge } = require('webpack-merge');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { createCommonConfig } = require('./webpack.common');
const domprops = require('./domprops.cjs');
const solidDelegatedEvents = require('./solid-delegated-events.cjs');
const { runObfuscationPrepass } = require('./obfuscate-build.cjs');
const { escapeStringLiterals } = require('./obfuscate-strings.cjs');
const { GLOBAL_OBJECT_IDENTIFIER } = require('./obfuscate-properties.cjs');

/**
 * @param {string} packageRoot
 * @returns {import('webpack').Configuration}
 */
function createProdConfig(packageRoot) {
  // Property-name obfuscation runs as a standalone pre-pass BEFORE webpack starts bundling
  // (see obfuscate-build.cjs's own doc comment for the full "why not a ts-loader hook"
  // story — short version: ts-loader's transpileOnly mode never builds a real cross-file
  // TypeChecker, so it can't resolve what type a property access belongs to). Prod-only,
  // matching Terser's own mangle.properties scope (dev builds stay fully readable for
  // debugging) — see obfuscate-properties.cjs for the full design doc comment. Scope is
  // this package's own src plus shared's src, since shared's classes (ECS core, physics,
  // etc.) get pulled directly into the client bundle by webpack's module graph the same way
  // ui's .tsx source does (see webpack.common.js's own rootDir-relaxed tsconfig.webpack.json
  // comment for that established pattern). protocol is deliberately NOT included — wire
  // packet field names are effectively part of the binary protocol's contract with the
  // server, and keeping protocol's own interfaces untouched avoids ever having to reason
  // about codec files specifically, even though this transform only ever touches
  // property-ACCESS syntax, never wire bytes.
  const obfuscatedOutDir = path.join(
    os.tmpdir(),
    `starve-obfuscated-${path.basename(packageRoot)}-${crypto.randomBytes(4).toString('hex')}`,
  );
  const { rootDir } = runObfuscationPrepass({
    tsconfigPath: path.join(packageRoot, 'tsconfig.webpack.json'),
    outDir: obfuscatedOutDir,
    scopeRoots: [path.join(packageRoot, 'src'), path.join(packageRoot, '../shared/src')],
    // Every directory this package's module graph can reach that isn't pure .ts — ui's
    // .tsx/.css files are pulled in via tsconfig.webpack.json's own rootDir-relaxed
    // "include" (see that file's doc comment) the same way shared's .ts is, so its assets
    // need mirroring too even though ui's .ts itself isn't in the *rewrite* scope above.
    mirrorRoots: [
      path.join(packageRoot, 'src'),
      path.join(packageRoot, '../shared/src'),
      path.join(packageRoot, '../ui/src'),
    ],
    // MAX of a per-class random range (each class independently rolls ~60-100% of this —
    // see randomCountInRange() in obfuscate-properties.transformer.cjs) of fake, never-read
    // PropertyDeclaration/MethodDeclaration members spliced at random positions among every
    // in-scope class's real members — see generateDecoyMembers() in obfuscate-properties.cjs
    // for the name/value/body pools and createObfuscationTransformer's decoyFieldCount/
    // decoyMethodCount parameters in obfuscate-properties.transformer.cjs for the
    // collision-safety and position-randomization details. Purely cosmetic noise on a dumped
    // instance's shape (e.g. in a devtools object inspector) — nothing in this codebase ever
    // calls a decoy method or reads a decoy field, so this cannot change program behavior;
    // it does not hide or slow down anyone reading the actual network protocol, render loop,
    // or physics code. At this count expect a real bundle-size increase (dozens of KB) and
    // a runtime cost to instantiating decorated classes (large, varied object shapes hurt
    // V8's hidden-class/inline-cache optimizations) — deliberately accepted here per an
    // explicit choice to prioritize decoy volume over bundle size/perf. Deliberately no fake
    // CONTROL FLOW (dead/opaque branches spliced into real method bodies) — this codebase
    // has strict tick/ordering invariants (see CLAUDE.md's PhysicsSystem/MovementSystem/CCD
    // notes) that make that kind of injection too risky for the payoff, so decoys stay
    // limited to inert, never-invoked static members regardless of count.
    decoyFieldCount: 30,
    decoyMethodCount: 20,
  });
  // Where packageRoot/src ended up inside the mirrored obfuscated tree — entry/resolve below
  // need to point INTO the obfuscated copy, not the original source, for the client's own
  // files (shared's files are reached transitively through relative imports from there, the
  // same way webpack's normal module graph already reaches into shared/src today).
  const obfuscatedPackageSrc = path.join(obfuscatedOutDir, path.relative(rootDir, path.join(packageRoot, 'src')));
  const obfuscatedSharedSrc = path.join(obfuscatedOutDir, path.relative(rootDir, path.join(packageRoot, '../shared/src')));
  const obfuscatedUiSrc = path.join(obfuscatedOutDir, path.relative(rootDir, path.join(packageRoot, '../ui/src')));

  const common = createCommonConfig(packageRoot, {
    styleLoader: MiniCssExtractPlugin.loader,
  });
  // HtmlWebpackPlugin's template (public/index.html) lives outside src/, so it was never
  // part of the obfuscation pre-pass's file set — createCommonConfig's own instance already
  // points at the real packageRoot correctly; only entry needs to be redirected below.
  common.plugins = (common.plugins ?? []).filter((plugin) => !(plugin instanceof HtmlWebpackPlugin));

  return merge(common, {
    mode: 'production',
    entry: path.join(obfuscatedPackageSrc, 'index.ts').replace(/\.ts$/, '.js'),
    resolve: {
      // The obfuscated tree lives under the OS temp dir, outside the repo entirely — Node's
      // usual upward node_modules search from there never reaches the real repo's
      // node_modules, so every bare-specifier import (solid-js, @starve/protocol, @starve/ui)
      // failed to resolve until this is added explicitly.
      modules: [path.resolve(packageRoot, '../../node_modules'), 'node_modules'],
      alias: {
        // Workspace packages resolve via node_modules/@starve/* symlinks straight to each
        // package's REAL (un-obfuscated) src by default (see each package's own
        // package.json "exports": "./src/index.ts") — without this override, a bare
        // `import ... from '@starve/shared'` would silently pull in the original,
        // never-rewritten source instead of the obfuscated mirror, defeating the whole
        // point for every shared class (this is exactly what happened before this alias
        // was added: World's own property accesses were never obfuscated because nothing
        // ever imported the obfuscated copy of World.js in the first place). @starve/protocol
        // is deliberately NOT aliased — it was never in scopeRoots/mirrorRoots to begin
        // with (see the scopeRoots comment above), so it keeps resolving to its real source
        // exactly as before.
        '@starve/shared': obfuscatedSharedSrc,
        '@starve/ui': obfuscatedUiSrc,
      },
      // TypeScript's ESNext module emit preserves each import's specifier exactly as written
      // in the source (extensionless relative imports stay extensionless in the emitted
      // .js) — webpack's default strict-ESM resolution then requires an explicit extension
      // on every relative import ("fully specified"), which the ORIGINAL .ts source was
      // never written to include (see e.g. `import { bootstrapClient } from
      // './bootstrap/ClientBootstrap'` in client/src/index.ts). This disables that
      // requirement so extensionless imports resolve the same way they already do when
      // ts-loader compiles .ts directly (the non-obfuscated dev/typecheck path).
      fullySpecified: false,
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          resolve: { fullySpecified: false },
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.join(packageRoot, 'public/index.html'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].[contenthash].css',
      }),
      // Provides `_gbl` as a free identifier to every module that references it, auto-
      // injecting an import from obfuscate-global-runtime.js — the same standard webpack
      // mechanism used for legacy `$`/`Buffer`/`process` shims. This is what backs
      // createObfuscationTransformer's bare-global-identifier rewrite (see
      // obfuscate-properties.transformer.cjs's isEligibleGlobalIdentifier —
      // `new WebSocket(...)` becomes `new _gbl[$T(i)](...)`, etc.): rather than each
      // obfuscated file synthesizing its own `var _gbl = (try/catch chain)` (an earlier
      // version did this — one redundant three-branch try/catch evaluated per file, ~30
      // times in a typical build, all resolving to the identical globalThis object),
      // ProvidePlugin resolves the module ONCE for the whole bundle and every consumer gets
      // the same reference. obfuscate-global-runtime.js itself is deliberately outside every
      // scopeRoots the obfuscation pre-pass uses, so its own globalThis/window/global/self
      // references are never themselves rewritten (that would be circular — it's the one
      // place that has to name them for real).
      new webpack.ProvidePlugin({
        [GLOBAL_OBJECT_IDENTIFIER]: require.resolve('./obfuscate-global-runtime.js'),
        // [GLOBAL_OBJECT_IDENTIFIER]: "global"
      }),
      // .css/.scss imports inside the mirrored obfuscated tree are byte-identical COPIES of
      // the real files (see runObfuscationPrepass — stylesheets are never rewritten, only
      // mirrored so relative imports from an obfuscated .js/.tsx resolve at all), but
      // @tailwindcss/postcss (see postcss.config.cjs) does its own `tailwindcss` module
      // resolution starting from the CSS file's OWN real filesystem location — from inside
      // the OS temp directory, that resolution walks upward and never reaches this repo's
      // node_modules, unlike webpack's own resolve.modules override above (which only
      // affects webpack's own resolution, not a loader's internal `require()` calls).
      // Rather than teach PostCSS about a temp-dir-specific node_modules path, this rewrites
      // any RESOLVED .css/.scss path inside obfuscatedOutDir back to its real source-tree
      // location — the file's CONTENT is identical either way (copies, not rewrites), so
      // this is a no-op for output correctness and just sidesteps the resolution problem.
      // Hooked directly (not via NormalModuleReplacementPlugin) because that plugin's single
      // callback is invoked from both its beforeResolve hook (request is still a relative
      // specifier like './ChatBox.module.css' — never matches an absolute obfuscatedOutDir
      // prefix) and its afterResolve hook (a differently-shaped `createData.resource`) —
      // only the latter has the absolute path this rewrite actually needs.
      {
        apply(/** @type {import('webpack').Compiler} */ compiler) {
          compiler.hooks.normalModuleFactory.tap('RedirectObfuscatedCss', (nmf) => {
            nmf.hooks.afterResolve.tap('RedirectObfuscatedCss', (result) => {
              const resource = result.createData.resource;
              if (
                typeof resource === 'string' &&
                /\.(css|scss)$/.test(resource) &&
                resource.startsWith(obfuscatedOutDir)
              ) {
                result.createData.resource = path.join(rootDir, path.relative(obfuscatedOutDir, resource));
              }
            });
          });
        },
      },
      // Without this, every `bun run build` leaves its obfuscatedOutDir behind in the OS
      // temp directory forever — os.tmpdir() is never cleaned by this project itself, and
      // each run uses a fresh random-suffixed directory (see obfuscatedOutDir above) rather
      // than a fixed reusable path, specifically so concurrent builds can't collide. Hooking
      // `done` (fires after both success and failure — unlike `afterEmit`, which only fires
      // on success) is what makes cleanup unconditional.
      {
        apply(/** @type {import('webpack').Compiler} */ compiler) {
          compiler.hooks.done.tap('CleanObfuscatedOutDir', () => {
            fs.rmSync(obfuscatedOutDir, { recursive: true, force: true });
          });
        },
      },
      // \x/\u-escapes every string literal's TEXT in the final, already-minified bundle —
      // see obfuscate-strings.cjs for the full design doc comment (short version: this is a
      // strictly weaker guarantee than the property-name obfuscation above — same plaintext
      // at parse time, just no literal grep match in the shipped source — and MUST run
      // after Terser, never before, since Terser's printer unconditionally re-normalizes
      // any string literal back to plain text on emit regardless of compress/mangle/format
      // settings, verified directly). Hooked at PROCESS_ASSETS_STAGE_DEV_TOOLING (runs after
      // PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE, where TerserPlugin/CssMinimizerPlugin hook) so
      // this always sees Terser's final output, never a pre-minification asset. Only touches
      // `.js` assets — CSS assets from MiniCssExtractPlugin/CssMinimizerPlugin pass through
      // this hook's iteration untouched (no `.js` extension match).
      {
        apply(/** @type {import('webpack').Compiler} */ compiler) {
          compiler.hooks.compilation.tap('EscapeStringLiterals', (compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: 'EscapeStringLiterals',
                stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING,
              },
              (assets) => {
                for (const assetName of Object.keys(assets)) {
                  if (!assetName.endsWith('.js')) {
                    continue;
                  }
                  const source = compilation.getAsset(assetName)?.source.source().toString();
                  if (source === undefined) {
                    continue;
                  }
                  const escaped = escapeStringLiterals(source, assetName);
                  compilation.updateAsset(assetName, new compiler.webpack.sources.RawSource(escaped));
                }
              },
            );
          });
        },
      },
    ],
    // No source maps in prod: devtool: 'source-map' previously emitted a public, unhidden
    // .js.map next to the bundle that browser devtools auto-load, showing fully-readable
    // ORIGINAL TypeScript source (real names, real strings) regardless of every obfuscation
    // pass above — closing that path matters more than the debugging convenience, and it
    // also means the post-Terser string-escape splice above never has stale map offsets to
    // worry about invalidating.
    devtool: false,
    output: {
      filename: '[name].[contenthash].js',
      chunkFilename: '[name].[contenthash].chunk.js',
      clean: true,
    },
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              passes: 2,
              toplevel: true,
              drop_console: false,
              drop_debugger: true,
              join_vars: false
            },
            mangle: {
              toplevel: true,
              // Mangles all object property names EXCEPT the reserved list, so our own
              // class fields/methods get shortened while every native browser API
              // interaction (domprops.cjs — className, style, addEventListener, canvas
              // context methods, etc.) and SolidJS's own $$<event>/$$<event>Data
              // delegated-event convention (solid-delegated-events.cjs — not a real DOM
              // API, so it's absent from domprops.cjs; see that file's doc comment for the
              // exact failure this caused when it wasn't reserved) stay intact.
              properties: {
                reserved: [...domprops, ...solidDelegatedEvents],
                keep_quoted: true,
              },
            },
            format: {
              comments: false,
            },
          },
          extractComments: false,
        }),
        new CssMinimizerPlugin(),
      ],
      usedExports: true,
      sideEffects: true,
      // Deliberately NOT splitting into separate chunks/a separate runtime file: Terser's
      // mangle.properties runs per-asset, and webpack's own chunk-loading bootstrap code
      // (emitted into every chunk) references __webpack_require__'s internal runtime
      // properties (short auto-generated names like `.e`/`.O`) the same way application
      // code references its own properties — Terser can't tell them apart, and mangling
      // each chunk file separately can assign inconsistent replacement names to the same
      // property across chunks, breaking chunk loading at runtime (e.g. `t.vn is not a
      // function`). This is a documented Terser limitation with bundlers, not fixable via
      // webpack config on the chunking side — Terser's own docs warn against combining
      // property mangling with a module bundler for exactly this reason. Keeping
      // everything in one file means Terser sees the whole program in a single pass, so
      // there's no cross-file mangling inconsistency to begin with.
      splitChunks: false,
      runtimeChunk: false,
    },
  });
}

module.exports = { createProdConfig };
