// @ts-check
const nodeConfig = require('./configs/eslint/node');
const browserConfig = require('./configs/eslint/browser');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs', '**/*.d.ts'],
  },
  ...nodeConfig.map((cfg) => ({
    ...cfg,
    files: ['packages/server/**/*.ts', 'packages/protocol/**/*.ts', 'packages/shared/**/*.ts', 'packages/tools/**/*.ts'],
  })),
  ...browserConfig.map((cfg) => ({
    ...cfg,
    files: ['packages/client/**/*.ts', 'packages/editor/**/*.ts'],
  })),
];
