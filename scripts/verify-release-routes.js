#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function fail(message) {
  process.stderr.write(`[X] ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const backendDistDir = args['backend-dist-dir'];
const context = args.context || 'release-check';

if (!backendDistDir || typeof backendDistDir !== 'string') {
  fail('missing required argument: --backend-dist-dir <path>');
}

const controllerFile = path.resolve(
  backendDistDir,
  'modules',
  'tools',
  'tools.controller.js',
);

if (!fs.existsSync(controllerFile)) {
  fail(`[${context}] route file not found: ${controllerFile}`);
}

const code = fs.readFileSync(controllerFile, 'utf8');
const checks = [
  {
    marker: "Get)('recent-extractions')",
    message: "GET /api/v1/tools/recent-extractions",
  },
  {
    marker: "Post)('recent-extractions')",
    message: "POST /api/v1/tools/recent-extractions",
  },
];

for (const check of checks) {
  if (!code.includes(check.marker)) {
    fail(`[${context}] missing route marker for ${check.message} in ${controllerFile}`);
  }
}

process.stdout.write(`[OK] [${context}] recent-extractions routes found in ${controllerFile}\n`);
