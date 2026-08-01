import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Vitest always runs specs through Vite's module graph, even when the `vitest` CLI
 * itself is invoked via `bun x vitest` — Vite's resolver doesn't know Bun's `bun:*`
 * built-in module scheme, so `import { Database } from 'bun:sqlite'` fails to resolve
 * even though the runtime executing the test *is* Bun and has it available globally.
 * This plugin marks `bun:*` specifiers external so Vite leaves the import as-is and
 * lets Bun's own runtime resolve it at execution time, instead of trying to bundle it.
 */
function bunBuiltinsPlugin(): Plugin {
  return {
    name: 'bun-builtins-external',
    enforce: 'pre',
    resolveId(source) {
      if (source.startsWith('bun:')) {
        return { id: source, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [bunBuiltinsPlugin()],
  test: {
    include: ['packages/**/*.spec.ts'],
    // Vitest's worker pools always fork Node child processes — even when the `vitest`
    // CLI itself was launched via `bun x vitest` — and Node's ESM loader cannot resolve
    // Bun-only builtins like `bun:sqlite`. Specs that need a real bun:sqlite run under
    // native `bun test` instead (see package.json's `test:bun` script); this suite covers
    // everything else.
    exclude: ['**/node_modules/**', '**/dist/**', '**/PlayerRepository.spec.ts'],
    environment: 'node',
    server: {
      deps: {
        external: [/^bun:/],
      },
    },
  },
  ssr: {
    external: ['bun:sqlite'],
  },
});
