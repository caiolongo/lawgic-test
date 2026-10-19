import { loadConfig } from '../../src/config/env.js';

export const silentLogger = { error() {}, warn() {} };

export function testConfig(env = {}) {
  return loadConfig({ MONGO_URI: 'mongodb://localhost:27017/nao-usado', LIA_BASE_URL: 'http://127.0.0.1:9', ...env });
}
