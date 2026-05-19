import { existsSync } from 'node:fs';
import * as path from 'node:path';

function looksLikeBackendRoot(dir: string): boolean {
  return (
    existsSync(path.join(dir, 'package.json')) &&
    existsSync(path.join(dir, 'src'))
  );
}

export function resolveBackendRoot(): string {
  const candidates = [
    process.cwd(),
    path.join(process.cwd(), 'backend'),
    path.resolve(__dirname, '..', '..'),
  ];

  for (const candidate of candidates) {
    if (looksLikeBackendRoot(candidate)) return candidate;
  }

  return process.cwd();
}

export function resolveProjectDataDir(...segments: string[]): string {
  return path.join(resolveBackendRoot(), 'data', ...segments);
}

export function resolveConfiguredDir(
  value: string | undefined | null,
  ...fallbackSegments: string[]
): string {
  const trimmed = value?.trim();
  if (trimmed) return path.resolve(trimmed);
  return resolveProjectDataDir(...fallbackSegments);
}
