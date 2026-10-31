import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, defaultConfig, loadConfig, resolveConfig } from '../src/config.js';
import { runClaimCheck, selectChecks } from '../src/run.js';
import { checkResult, errors, findings, fixture, runFixture, summary } from './helpers.js';

describe('resolveConfig', () => {
  it('merges partial sections over the defaults', () => {
    const config = resolveConfig({ links: { timeoutMs: 1000 }, skip: ['commands'] });
    expect(config.links.timeoutMs).toBe(1000);
    expect(config.links.concurrency).toBe(defaultConfig().links.concurrency);
    expect(config.skip).toEqual(['commands']);
    expect(config.docs).toEqual(defaultConfig().docs);
  });

  it.each([
    [{ unknown: true }, 'config.unknown is not a known option'],
    [{ docs: 'README.md' }, 'config.docs must be an array of strings'],
    [{ only: ['spelling'] }, 'config.only contains unknown check "spelling"'],
    [{ links: { timeoutMs: -1 } }, 'config.links.timeoutMs must be a positive number'],
    [{ links: { extrnal: true } }, 'config.links.extrnal is not a known option'],
    [{ env: { stale: 'loud' } }, 'config.env.stale must be one of "error", "warning", "off"'],
    [{ commands: { env: { A: 1 } } }, 'config.commands.env must be an object whose values are strings'],
    [[], 'config must be an object'],
  ])('rejects %j', (raw, message) => {
    expect(() => resolveConfig(raw)).toThrow(ConfigError);
    expect(() => resolveConfig(raw)).toThrow(message);
  });
});

describe('loadConfig', () => {
  it('uses defaults when there is no config file', () => {
    expect(loadConfig(fixture('paths/good'))).toEqual({ config: defaultConfig(), file: null });
  });

  it('finds claimcheck.config.json in the project root', () => {
    const { config, file } = loadConfig(fixture('configured'));
    expect(file).toMatch(/claimcheck\.config\.json$/);
    expect(config.docs).toEqual(['README.md']);
  });

  it('reports missing and malformed files clearly', () => {
    expect(() => loadConfig(fixture('paths/good'), 'nope.json')).toThrow('Config file not found: nope.json');
    const dir = mkdtempSync(join(tmpdir(), 'claim-check-config-'));
    try {
      writeFileSync(join(dir, '.claimcheck.json'), '{ not json');
      expect(() => loadConfig(dir)).toThrow(/Could not parse/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('selectChecks', () => {
  it('lets the command line override "only" and add to "skip"', () => {
    const config = resolveConfig({ only: ['paths', 'links'], skip: ['links'] });
    expect(selectChecks(config)).toEqual(['paths']);
    expect(selectChecks(config, ['env', 'scripts'])).toEqual(['scripts', 'env']);
    expect(selectChecks(config, undefined, ['paths'])).toEqual([]);
  });
});

describe('config in a project', () => {
  it('applies docs, ignore, per-check ignores and skip', async () => {
    const result = await runFixture('configured');
    expect(result.docs).toEqual(['README.md']);
    expect(findings(result)).toEqual([]);
    expect(checkResult(result, 'endpoints').status).toBe('skipped');
    expect(checkResult(result, 'paths').checked).toBe(1);
  });

  it('fails on warnings when failOn is "warning"', async () => {
    const result = await runFixture('commands/drifted', { only: ['commands'], failOn: 'warning' });
    expect(result.summary.warnings).toBe(1);
    expect(result.summary.passed).toBe(false);
  });

  it('reports a project with no Markdown files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-check-empty-'));
    try {
      await expect(runClaimCheck({ root: dir })).rejects.toThrow(/No Markdown files found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ignore directives', () => {
  it('suppresses findings in ignored blocks, lines and regions only', async () => {
    const result = await runFixture('directives');
    expect(summary(errors(result))).toEqual([
      'README.md:14 Path "src/reported.ts" does not exist',
      'README.md:16 Link target "./missing.md" does not exist',
    ]);
  });
});
