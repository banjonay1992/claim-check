import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/reporters/index.js';
import { escapeXml } from '../src/reporters/junit.js';
import { runFixture } from './helpers.js';

describe('reporters', () => {
  it('human: groups findings by file with a check summary and no colour codes when disabled', async () => {
    const result = await runFixture('paths/drifted');
    const text = formatReport(result, 'human', { color: false });
    expect(text).toContain('README.md\n  3:10  error    Link target "./docs/setup.md" does not exist  paths');
    expect(text).toContain('Found "docs/guide.md"');
    expect(text).toMatch(/paths\s+fail\s+7 claims, 6 errors/);
    expect(text).toContain('Doc drift found. 6 errors, 0 warnings');
    expect(text).not.toContain('\u001b[');
  });

  it('human: colours output when asked and hides warnings in quiet mode', async () => {
    const result = await runFixture('env/drifted', { only: ['env'] });
    expect(formatReport(result, 'human', { color: true })).toContain('\u001b[31m');
    const quiet = formatReport(result, 'human', { quiet: true });
    expect(quiet).not.toContain('UNUSED_FLAG');
    expect(quiet).toContain('SIGNING_KEY');
  });

  it('json: emits the full result', async () => {
    const result = await runFixture('paths/drifted', { only: ['paths'] });
    const parsed = JSON.parse(formatReport(result, 'json')) as typeof result;
    expect(parsed.summary).toMatchObject({ errors: 6, passed: false });
    expect(parsed.checks.find((c) => c.id === 'paths')?.findings[0]).toMatchObject({
      check: 'paths',
      severity: 'error',
      file: 'README.md',
      line: 3,
    });
  });

  it('junit: one suite per check, failures for errors and skips for skipped checks', async () => {
    const result = await runFixture('scripts/drifted', { only: ['scripts'] });
    const xml = formatReport(result, 'junit');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<testsuite name="scripts" tests="5" failures="5"');
    expect(xml).toContain('<failure message="Script &quot;deploy&quot; is not defined in package.json" type="error">');
    expect(xml).toContain('<testsuite name="paths" tests="1" failures="0" errors="0" skipped="1"');
    expect(xml.match(/<testsuite /g)).toHaveLength(6);
  });

  it('junit: escapes XML special and control characters', () => {
    expect(escapeXml('<a href="x">&\'\u0001</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  });

  it('sarif: valid 2.1.0 structure with rules, levels and locations', async () => {
    const result = await runFixture('env/drifted', { only: ['env'] });
    const sarif = JSON.parse(formatReport(result, 'sarif')) as {
      version: string;
      runs: { tool: { driver: { name: string; rules: { id: string }[] } }; results: Record<string, any>[] }[];
    };
    expect(sarif.version).toBe('2.1.0');
    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe('claim-check');
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual(['paths', 'links', 'scripts', 'env', 'endpoints', 'commands']);
    expect(run.results).toHaveLength(4);
    const first = run.results.find((r) => r.message.text.startsWith('SIGNING_KEY'))!;
    expect(first).toMatchObject({
      ruleId: 'env',
      ruleIndex: 3,
      level: 'error',
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/config.ts' }, region: { startLine: 3 } } }],
    });
    expect(run.results.some((r) => r.level === 'warning')).toBe(true);
  });

  it('sarif: leaves notes out', async () => {
    const result = await runFixture('commands/good', { only: ['commands'] });
    const sarif = JSON.parse(formatReport(result, 'sarif')) as { runs: { results: unknown[] }[] };
    expect(sarif.runs[0]?.results).toEqual([]);
  });
});
