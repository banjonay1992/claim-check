import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execScript, extractScript } from '../src/checks/commands.js';
import { defaultConfig } from '../src/config.js';
import { parseDoc } from '../src/docs/parse.js';
import { runClaimCheck } from '../src/run.js';
import { checkResult, errors, findings, fixture, runFixture, summary } from './helpers.js';

describe('extractScript', () => {
  it('keeps plain shell blocks as they are', () => {
    const doc = parseDoc('R.md', '```sh\necho a\necho b\n```');
    expect(extractScript(doc.codeBlocks[0]!)).toBe('echo a\necho b');
  });

  it('keeps only prompt lines and continuations in console blocks', () => {
    const doc = parseDoc('R.md', '```console\n$ echo a \\\n  b\na b\n$ ls\nfile\n```');
    expect(extractScript(doc.codeBlocks[0]!)).toBe('echo a \\\n  b\nls');
  });
});

describe('execScript', () => {
  it('reports exit codes and output', async () => {
    const result = await execScript('echo out; echo err >&2; exit 4', tmpdir(), { shell: 'bash', env: {} }, 5000);
    expect(result.code).toBe(4);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('stops on the first failing command and on pipeline failures', async () => {
    expect((await execScript('false\nexit 0', tmpdir(), { shell: 'bash', env: {} }, 5000)).code).toBe(1);
    expect((await execScript('false | true', tmpdir(), { shell: 'bash', env: {} }, 5000)).code).toBe(1);
  });

  it('passes configured environment variables', async () => {
    const result = await execScript('test "$GREETING" = hi && test "$CLAIM_CHECK" = 1', tmpdir(), { shell: 'bash', env: { GREETING: 'hi' } }, 5000);
    expect(result.code).toBe(0);
  });

  it('times out long-running commands', async () => {
    const result = await execScript('sleep 5', tmpdir(), { shell: 'bash', env: {} }, 200);
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(4000);
  });
});

describe('commands check', () => {
  it('only lists runnable blocks without --run', async () => {
    const result = await runFixture('commands/good', { only: ['commands'] });
    const list = findings(result, 'commands');
    expect(list.map((f) => f.severity)).toEqual(['note', 'note', 'note', 'note']);
    expect(list[0]?.message).toContain('echo hello > out.txt');
    expect(result.summary.passed).toBe(true);
  });

  it('runs blocks in a temporary copy, leaving the project untouched', async () => {
    const result = await runFixture('commands/good', { only: ['commands'], run: true });
    expect(findings(result)).toEqual([]);
    expect(checkResult(result, 'commands').checked).toBe(4);
    expect(existsSync(join(fixture('commands/good'), 'out.txt'))).toBe(false);
  });

  it('reports failures, timeouts, wrong exit codes, missing directories and non-shell blocks', async () => {
    const result = await runFixture('commands/drifted', { only: ['commands'], run: true });
    expect(summary(errors(result))).toEqual([
      'README.md:3 Command exited with code 1 (expected 0): echo "about to fail" ...',
      'README.md:8 Command timed out after 300ms: sleep 5',
      'README.md:13 Command exited with code 2 (expected 0): exit 2',
      'README.md:22 Working directory "missing-dir" does not exist',
    ]);
    expect(errors(result)[0]?.hint).toContain('about to fail');
    expect(findings(result).filter((f) => f.severity === 'warning')).toHaveLength(1);
  });

  it('can run in place when configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-check-inplace-'));
    try {
      writeFileSync(join(dir, 'README.md'), '# In place\n\n```sh claim-check:run\ntouch created.txt\n```\n');
      const config = defaultConfig();
      config.commands.workdir = 'inplace';
      const result = await runClaimCheck({ root: dir, config, only: ['commands'], run: true });
      expect(findings(result)).toEqual([]);
      expect(existsSync(join(dir, 'created.txt'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
