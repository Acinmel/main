#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
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
const context = args.context || 'seed-check';

if (!backendDistDir || typeof backendDistDir !== 'string') {
  fail('missing required argument: --backend-dist-dir <path>');
}

const serviceFile = path.resolve(
  backendDistDir,
  'modules',
  'resources',
  'resources.service.js',
);

if (!fs.existsSync(serviceFile)) {
  fail(`[${context}] file not found: ${serviceFile}`);
}

const code = fs.readFileSync(serviceFile, 'utf8');
const requiredSeedIds = [
  'rec-subtitle-a-classic-white-yellow',
  'rec-subtitle-b-white-green-tech',
  'rec-subtitle-c-white-red-impact',
  'rec-subtitle-d-black-yellow-alert',
  'rec-subtitle-e-white-blue-pro',
  'rec-subtitle-f-white-orange-commerce',
  'rec-subtitle-g-ivory-gold-brand',
  'rec-subtitle-h-white-purple-trend',
  'rec-subtitle-i-cyan-white-fresh',
  'rec-subtitle-j-white-pink-lifestyle',
];

const missing = requiredSeedIds.filter((id) => !code.includes(id));
if (missing.length) {
  fail(
    `[${context}] subtitle seed ids missing from dist (${missing.length}): ${missing.join(', ')}`,
  );
}

if (!code.includes('upsertRecommendedSubtitleTemplates(now)')) {
  fail(`[${context}] missing upsertRecommendedSubtitleTemplates bootstrap call`);
}

process.stdout.write(
  `[OK] [${context}] subtitle seed markers found in ${serviceFile}\n`,
);
