// @ts-check
const path = require('node:path');
const { createProdConfig } = require('./webpack.prod');

module.exports = createProdConfig(path.resolve(__dirname, '../../packages/client'));
