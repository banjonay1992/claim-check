import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_DRIFT, EXIT_OK, EXIT_USAGE, main } from '../src/main.js';
import { FIXTURES, fixture } from './helpers.js';

async function cli(args: string[], env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    stdout: { write: (t: string) => (stdout += t), isTTY: false },
    stderr: { write: (t: string) => (stderr += t) },
    cwd: FIXTURES,
    env,
  });
  return { code, stdout, stderr };
}

describe('cli', () => {
  it('prints help and version', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(EXIT_OK);
    expect(help.stdout).toContain('Usage: claim-check [dir] [options]');
    const version = await cli(['-v']);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('lists checks', async () => {
    const { stdout } = await cli(['--list-checks']);
    expect(stdout.split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0])).toEqual([
      'paths', 'links', 'scripts', 'env', 'endpoints', 'commands',
    ]);
  });

  it('exits 0 for a clean project and 1 for drift, relative to the working directory', async () => {
    expect((await cli(['paths/good'])).code).toBe(EXIT_OK);
    const drifted = await cli(['paths/drifted']);
    expect(drifted.code).toBe(EXIT_DRIFT);
    expect(drifted.stdout).toContain('src/old-name.ts');
  });

  it('supports --json, --only and --skip', async () => {
    const { code, stdout } = await cli(['scripts/drifted', '--json', '--only', 'scripts,paths', '--skip', 'paths']);
    expect(code).toBe(EXIT_DRIFT);
    const result = JSON.parse(stdout) as { checks: { id: string; status: string }[] };
    expect(result.checks.filter((c) => c.status !== 'skipped').map((c) => c.id)).toEqual(['scripts']);
  });

  it('runs commands only with --run', async () => {
    expect((await cli(['commands/drifted', '--only', 'commands'])).code).toBe(EXIT_OK);
    expect((await cli(['commands/drifted', '--only', 'commands', '--run'])).code).toBe(EXIT_DRIFT);
  });

  it('writes reports to a file with --output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-check-cli-'));
    try {
      const out = join(dir, 'report.xml');
      const { code, stdout, stderr } = await cli(['links/drifted', '-f', 'junit', '-o', out]);
      expect(code).toBe(EXIT_DRIFT);
      expect(stdout).toBe('');
      expect(stderr).toContain('wrote junit report');
      expect(readFileSync(out, 'utf8')).toContain('<testsuites name="claim-check"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses an explicit config file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-check-cli-'));
    try {
      const configFile = join(dir, 'custom.json');
      writeFileSync(configFile, JSON.stringify({ paths: { ignore: ['src/**', 'Docs/**', 'images/**', 'CONTRIBUTING.md', './docs/setup.md'] } }));
      expect((await cli(['paths/drifted', '--config', configFile])).code).toBe(EXIT_OK);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours NO_COLOR and FORCE_COLOR', async () => {
    expect((await cli(['paths/drifted'], { FORCE_COLOR: '1' })).stdout).toContain('\u001b[');
    expect((await cli(['paths/drifted'], { FORCE_COLOR: '1', NO_COLOR: '1' })).stdout).not.toContain('\u001b[');
    expect((await cli(['paths/drifted', '--no-color'], { FORCE_COLOR: '1' })).stdout).not.toContain('\u001b[');
  });

  it.each([
    [['--bogus'], "Unknown option '--bogus'"],
    [['--only', 'spelling'], 'Unknown check "spelling" in --only'],
    [['--format', 'xml'], 'Unknown format "xml"'],
    [['--json', '--format', 'sarif'], '--json cannot be combined'],
    [['--fail-on', 'note'], '--fail-on must be "error" or "warning"'],
    [['a', 'b'], 'Expected at most one directory'],
    [['does-not-exist'], 'Project directory not found'],
    [['paths/good', '-c', 'missing.json'], 'Config file not found'],
  ])('exits 2 with a clear message for %j', async (args, message) => {
    const { code, stderr } = await cli(args);
    expect(code).toBe(EXIT_USAGE);
    expect(stderr).toContain(message);
  });

  it('exits 2 for an invalid config file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-check-cli-'));
    try {
      writeFileSync(join(dir, 'README.md'), '# Hi\n');
      writeFileSync(join(dir, 'claimcheck.config.json'), JSON.stringify({ failOn: 'sometimes' }));
      const { code, stderr } = await cli([dir]);
      expect(code).toBe(EXIT_USAGE);
      expect(stderr).toContain('claimcheck.config.json.failOn must be one of "error", "warning"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can be pointed at an absolute fixture path', async () => {
    expect((await cli([fixture('links/good'), '-q'])).code).toBe(EXIT_OK);
  });
});
