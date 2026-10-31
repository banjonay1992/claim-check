import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runClaimCheck, type RunOptions } from '../src/run.js';
import type { CheckId, Finding, RunResult } from '../src/types.js';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function fixture(name: string): string {
  return join(FIXTURES, name);
}

export async function runFixture(name: string, options: Omit<RunOptions, 'root'> = {}): Promise<RunResult> {
  return runClaimCheck({ root: fixture(name), ...options });
}

export function findings(result: RunResult, check?: CheckId): Finding[] {
  return result.checks.filter((c) => !check || c.id === check).flatMap((c) => c.findings);
}

export function errors(result: RunResult, check?: CheckId): Finding[] {
  return findings(result, check).filter((f) => f.severity === 'error');
}

export function checkResult(result: RunResult, check: CheckId) {
  const found = result.checks.find((c) => c.id === check);
  if (!found) throw new Error(`No result for ${check}`);
  return found;
}

/** A compact "file:line message" view that makes assertions readable. */
export function summary(list: Finding[]): string[] {
  return list.map((f) => `${f.file}:${f.line} ${f.message}`);
}
