import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cached: string | undefined;

/** Reads the package version from package.json next to the built output. */
export function getVersion(): string {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'claim-check' && pkg.version) {
        cached = pkg.version;
        return cached;
      }
    } catch {
      // try the next candidate
    }
  }
  cached = '0.0.0';
  return cached;
}
