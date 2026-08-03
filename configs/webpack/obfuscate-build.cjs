// @ts-check
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const { createScopeChecker, createDomPropChecker } = require('./obfuscate-properties.cjs');
const { createObfuscationTransformer } = require('./obfuscate-properties.transformer.cjs');
const domprops = require('./domprops.cjs');

/**
 * Runs property-name obfuscation as a standalone pre-pass BEFORE webpack ever starts
 * bundling — see obfuscate-properties.cjs for the overall design doc comment, and
 * obfuscate-properties.transformer.cjs's isEligibleSymbol() doc comment for why this exists
 * as a separate pass rather than a ts-loader `getCustomTransformers` hook (the short version:
 * ts-loader's transpileOnly mode calls `ts.transpileModule()` per file, which has no
 * multi-file TypeChecker at all, so it can never resolve what a property access's owning
 * type is — only a real `ts.Program` with every file loaded can do that).
 *
 * This function builds one real, complete Program (rootDir-relaxed the same way
 * tsconfig.webpack.json already is, so cross-package imports from packages/shared/protocol
 * resolve — see that config's own doc comment for why), runs `program.emit()` with the
 * obfuscation transformer wired into `customTransformers.before`, and writes the resulting
 * `.js` straight to `outDir`. Only `.ts` files are emitted this way — `.tsx` (SolidJS
 * components, see packages/ui) are deliberately left where they are, since this project
 * already routes those through babel-loader instead of ts-loader/tsc for both dev and prod
 * (real type-checking for them happens separately via `bun run typecheck` and
 * ForkTsCheckerWebpackPlugin) — obfuscating .tsx would need a Babel-side equivalent of this
 * same transform, out of scope here.
 *
 * Everything the emitted `.js` might still import that ISN'T `.ts` — `.tsx` components,
 * `.module.css`/`.scss`/plain `.css` stylesheets, `.d.ts` ambient declarations (irrelevant
 * to a JS bundle but harmless to mirror) — is copied byte-for-byte alongside the emitted
 * output, at the same rootDir-relative path TypeScript itself uses for emitted files.
 * Without this, an emitted `packages/ui/src/index.js` importing `./components/ChatBox.tsx`
 * would resolve against the OUTPUT directory (where only `.js` exists) and fail to find it.
 *
 * These non-.ts assets are collected by directly WALKING each of `mirrorRoots`'s
 * directories on disk, not from TypeScript's own `parsed.fileNames` — that list only
 * contains files TS's own module resolution can reach by following `import`/`require`
 * statements it understands as TS/JS modules; asset imports like `import
 * './styles/global.scss'` are never traversed into by the compiler at all (there's no
 * `.scss` module for it to parse), so `.scss`/`.css` files never appeared in `fileNames`
 * and were silently dropped by an earlier version of this function that relied on it.
 *
 * `.ts` root file discovery ALSO walks `mirrorRoots` directly, rather than trusting
 * `parsed.fileNames` alone to cover cross-package files like packages/shared/src/**\/*.ts —
 * `Program.emit()` with no target argument only emits files that were passed in as one of
 * the Program's own ROOT names, not every file the Program transitively resolved while
 * type-checking (module resolution pulling in shared/protocol's .ts for type info does NOT
 * make emit() write output for them). An earlier version of this function relied on
 * `parsed.fileNames` (populated only from packages/client/tsconfig.webpack.json's own
 * "include": ["src", "../ui/src"]) for root names, so packages/shared/src/**\/*.ts was
 * type-checked (imports resolved fine) but never actually emitted — producing an
 * import for a shared class whose .js simply didn't exist in the output tree, which
 * silently became `undefined` at the import site rather than a build error.
 *
 * @param {object} config
 * @param {string} config.tsconfigPath absolute path to the tsconfig to build the Program from (e.g. packages/client/tsconfig.webpack.json)
 * @param {string} config.outDir absolute path to write obfuscated .js output to
 * @param {string[]} config.scopeRoots absolute source roots eligible for rewriting (see createScopeChecker)
 * @param {string[]} config.mirrorRoots absolute directories to walk for non-.ts asset
 *   mirroring (see above) — typically a superset of scopeRoots, since e.g. packages/ui's
 *   .tsx/.css files must be mirrored even though ui's .ts files aren't in the obfuscation
 *   scope boundary itself... actually ui's .ts *is* compiled (it's part of the same
 *   Program via tsconfig.webpack.json's own "include"), just not eligible for rewriting
 *   unless explicitly added to scopeRoots.
 * @returns {{ outDir: string, rootDir: string }}
 */
function runObfuscationPrepass({ tsconfigPath, outDir, scopeRoots, mirrorRoots }) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));

  // Only compile .ts here — .tsx goes through babel-loader untouched (see doc comment above).
  // Union of tsconfig's own resolved file list AND a direct walk of mirrorRoots — see the
  // module doc comment above for why the walk is required (emit() only writes output for
  // its own root files, and tsconfig.webpack.json's "include" never lists cross-package
  // directories like packages/shared/src explicitly).
  const rootNameSet = new Set(parsed.fileNames.filter((fileName) => fileName.endsWith('.ts')));
  for (const mirrorRoot of mirrorRoots) {
    for (const fileName of walkFilesWithExtension(mirrorRoot, '.ts')) {
      rootNameSet.add(fileName);
    }
  }
  const rootNames = [...rootNameSet];

  const compilerOptions = {
    ...parsed.options,
    outDir,
    noEmit: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    // This pass only needs to produce valid JS for webpack to bundle — real type-checking
    // already happened via `bun run typecheck` (tsc --build) earlier in the same `bun run
    // build` script (see root package.json) and via ForkTsCheckerWebpackPlugin during dev;
    // re-running full diagnostics here would just duplicate that work for no benefit.
    noEmitOnError: false,
  };
  const rootDir = compilerOptions.rootDir
    ? path.resolve(path.dirname(tsconfigPath), compilerOptions.rootDir)
    : path.dirname(tsconfigPath);

  const program = ts.createProgram({ rootNames, options: compilerOptions });
  const getProgram = () => program;
  const isInScope = createScopeChecker(scopeRoots);
  // Also rewrite DOM/Web API property accesses (ctx.fillRect, ws.send, canvas.style, etc.)
  // written in our own in-scope source into computed $T(i) lookups — see
  // createDomPropChecker()'s and createObfuscationTransformer()'s own doc comments for what
  // this does and does not achieve (the real DOM property name is unchanged at runtime;
  // only the static identifier is removed from the bundle's source text).
  const isDomProp = createDomPropChecker(domprops);
  const transformer = createObfuscationTransformer(getProgram, isInScope, isDomProp);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // String-literal \x/\u escaping (see obfuscate-strings.cjs) deliberately does NOT run
  // here. Terser's printer unconditionally re-normalizes every string literal to its
  // canonical plain-text form on emit — verified directly (even with compress/mangle
  // disabled) — so escaping before Terser runs (this pre-pass, which executes before
  // webpack even starts bundling) is silently undone by the time the final bundle is
  // written. escapeStringLiterals() instead runs as a POST-Terser webpack processAssets
  // hook — see webpack.prod.js's EscapeStringLiteralsPlugin — operating on the final
  // minified bundle text where nothing downstream will re-print and undo it.
  const emitResult = program.emit(undefined, undefined, undefined, false, {
    before: [transformer],
  });

  const errors = emitResult.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (fileName) => fileName,
      getNewLine: () => ts.sys.newLine,
    });
    throw new Error(`Obfuscation pre-pass emit failed:\n${formatted}`);
  }

  for (const mirrorRoot of mirrorRoots) {
    for (const fileName of walkFiles(mirrorRoot, (ext) => ext !== '.ts')) {
      const relative = path.relative(rootDir, fileName);
      const destination = path.join(outDir, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(fileName, destination);
    }
  }

  return { outDir, rootDir };
}

/**
 * Recursively yields every file under `dir` whose extname() is `extension` — used for
 * `.ts` root-file discovery (see the module doc comment for why walking is necessary).
 * @param {string} dir
 * @param {string} extension e.g. '.ts'
 * @returns {Generator<string>}
 */
function* walkFilesWithExtension(dir, extension) {
  yield* walkFiles(dir, (ext) => ext === extension);
}

/**
 * Recursively yields every file under `dir` for which `predicate(extname)` is true.
 * @param {string} dir
 * @param {(extension: string) => boolean} predicate
 * @returns {Generator<string>}
 */
function* walkFiles(dir, predicate) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath, predicate);
    } else if (entry.isFile() && predicate(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

module.exports = { runObfuscationPrepass };
