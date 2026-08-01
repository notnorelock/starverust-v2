// @ts-check
const path = require('node:path');
const { createDevConfig } = require('./webpack.dev');

module.exports = createDevConfig(path.resolve(__dirname, '../../packages/client'), {
  port: 8080,
});
