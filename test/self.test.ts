import { describe, expect, it } from 'vitest';
import { runClaimCheck } from '../src/run.js';
import { REPO_ROOT } from './helpers.js';

describe('self-check', () => {
  it("this repository's own docs pass Claim Check", async () => {
    const result = await runClaimCheck({ root: REPO_ROOT });
    const problems = result.checks.flatMap((c) => c.findings).filter((f) => f.severity !== 'note');
    expect(problems).toEqual([]);
    expect(result.docs).toEqual(expect.arrayContaining(['README.md', 'CONTRIBUTING.md', 'ROADMAP.md']));
  });
});
