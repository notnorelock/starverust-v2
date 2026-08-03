// @ts-check
const { merge } = require('webpack-merge');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { createCommonConfig } = require('./webpack.common');
const domprops = require('./domprops.cjs');
const solidDelegatedEvents = require('./solid-delegated-events.cjs');

/**
 * @param {string} packageRoot
 * @returns {import('webpack').Configuration}
 */
function createProdConfig(packageRoot) {
  const common = createCommonConfig(packageRoot, {
    styleLoader: MiniCssExtractPlugin.loader,
  });

  return merge(common, {
    mode: 'production',
    devtool: 'source-map',
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
              join_vars: false,
              hoist_funs: true,
              hoist_vars: true,
              hoist_props: true,
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
    plugins: [
      new MiniCssExtractPlugin({
        filename: '[name].[contenthash].css',
      }),
    ],
  });
}

module.exports = { createProdConfig };
