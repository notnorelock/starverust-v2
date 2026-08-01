// @ts-check
const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

/**
 * Builds the shared portion of the webpack config for a package.
 * @param {string} packageRoot - absolute path to the consuming package (e.g. packages/client)
 * @param {object} [options]
 * @param {string | { loader: string, options?: object }} [options.styleLoader] - the loader
 *   that injects extracted CSS ('style-loader' for dev's inline <style> tags,
 *   MiniCssExtractPlugin.loader for prod's separate .css file). Defaults to 'style-loader'.
 *   This is a parameter (not a second rule set merged in by webpack.prod.js) specifically
 *   because webpack-merge concatenates `module.rules` arrays rather than replacing them —
 *   defining SCSS rules in both webpack.common.js and webpack.prod.js made every
 *   .module.scss file match twice and get double-processed.
 * @param {Array<string | { loader: string, options?: object }>} [options.postTsLoaders] - extra
 *   loaders run after ts-loader in the `.ts` chain (webpack loaders run right-to-left, so
 *   these end up processing ts-loader's output). Unused today (empty by default) but kept
 *   as an extension point — same reasoning as styleLoader: a parameter here, not a second
 *   `.ts` rule merged in by webpack.prod.js, to avoid the same double-processing problem.
 * @returns {import('webpack').Configuration}
 */
function createCommonConfig(packageRoot, options = {}) {
  const { styleLoader = 'style-loader', postTsLoaders = [] } = options;

  return {
    entry: path.join(packageRoot, 'src/index.ts'),
    resolve: {
      extensions: ['.ts', '.js'],
      extensionAlias: {
        '.js': ['.ts', '.js'],
      },
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          // Loaders run right-to-left: ts-loader (last) runs first and transpiles TS ->
          // JS; postTsLoaders (empty today) would run on that output if ever needed.
          use: [
            ...postTsLoaders,
            {
              loader: 'ts-loader',
              options: {
                transpileOnly: true,
                // The package's own tsconfig.json sets rootDir/composite for `tsc --build`
                // project-reference type-checking (see root `bun run typecheck`). Webpack's
                // module graph reaches into sibling workspace packages (shared, protocol),
                // which ts-loader would reject as "not under rootDir" — so bundling uses a
                // separate, looser tsconfig with no rootDir restriction instead.
                configFile: path.join(packageRoot, 'tsconfig.webpack.json'),
              },
            },
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.module\.scss$/,
          use: [
            styleLoader,
            {
              loader: 'css-loader',
              options: {
                modules: {
                  // localIdentName: '[name]__[local]--[hash:base64:5]',
                  localIdentName: '[hash:base64:14]',
                  // css-loader v7 defaults to named exports only; this project imports the
                  // class-map as a default export (`import styles from './x.module.scss'`),
                  // so namedExport must be explicitly disabled to get that default back.
                  namedExport: false,
                },
              },
            },
            'sass-loader',
          ],
        },
        {
          test: /\.scss$/,
          exclude: /\.module\.scss$/,
          use: [styleLoader, 'css-loader', 'sass-loader'],
        },
        {
          test: /\.(png|jpe?g|gif|svg|webp)$/i,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.join(packageRoot, 'public/index.html'),
      }),
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          // Real cross-package type-checking runs via `bun run typecheck` (tsc --build,
          // which correctly understands project references). This plugin only needs to
          // catch errors within the bundle's own module graph during dev, using the same
          // rootDir-relaxed config ts-loader uses above.
          configFile: path.join(packageRoot, 'tsconfig.webpack.json'),
        },
      }),
    ],
  };
}

module.exports = { createCommonConfig };
