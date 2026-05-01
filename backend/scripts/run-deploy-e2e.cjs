/**
 * 设置 E2E_DEPLOY=1 后执行 deploy-smoke e2e（跨平台）。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
process.env.E2E_DEPLOY = '1';

const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
const r = spawnSync(process.execPath, [
  jestBin,
  '--config',
  path.join(root, 'test', 'jest-e2e.json'),
  '--testPathPatterns=deploy-smoke',
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
