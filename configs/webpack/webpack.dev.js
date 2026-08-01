// @ts-check
const { merge } = require('webpack-merge');
const { createCommonConfig } = require('./webpack.common');

/**
 * @param {string} packageRoot
 * @param {{ port?: number }} [options]
 * @returns {import('webpack').Configuration}
 */
function createDevConfig(packageRoot, options = {}) {
  const { port = 8080 } = options;

  // No dev-server proxy for the game's WebSocket: the client (NetworkClient /
  // resolveWebSocketUrl) connects directly to the game server's port (8081) rather
  // than through webpack-dev-server. A proxy on a shared path like `/ws` previously
  // collided with webpack-dev-server's own HMR WebSocket, which defaults to that
  // same path — every HMR reconnect attempt was being routed into the game server's
  // binary protocol and failing with "Invalid frame header".
  return merge(createCommonConfig(packageRoot), {
    mode: 'development',
    devtool: 'eval-source-map',
    devServer: {
      port,
      hot: true,
      historyApiFallback: true,
    },
  });
}

module.exports = { createDevConfig };
