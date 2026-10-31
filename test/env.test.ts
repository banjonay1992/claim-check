import { describe, expect, it } from 'vitest';
import { findEnvMentions, findEnvReads, parseEnvExample } from '../src/checks/env.js';
import { defaultConfig } from '../src/config.js';
import { parseDoc } from '../src/docs/parse.js';
import { checkResult, findings, fixture, runFixture, summary } from './helpers.js';
import { runClaimCheck } from '../src/run.js';

const reads = (source: string) => findEnvReads(source, 'x').map((r) => r.name);

describe('findEnvReads', () => {
  it.each([
    ['process.env.API_KEY', 'API_KEY'],
    ["process.env['API_KEY']", 'API_KEY'],
    ['import.meta.env.VITE_URL', 'VITE_URL'],
    ["Deno.env.get('REGION')", 'REGION'],
    ['Bun.env.BUN_PORT', 'BUN_PORT'],
    ['os.environ["DB_URL"]', 'DB_URL'],
    ["os.environ.get('DB_URL')", 'DB_URL'],
    ["os.getenv('DB_URL')", 'DB_URL'],
    ["ENV.fetch('RAILS_HOST')", 'RAILS_HOST'],
    ["ENV['RAILS_HOST']", 'RAILS_HOST'],
    ['os.Getenv("GO_PORT")', 'GO_PORT'],
    ['os.LookupEnv("GO_PORT")', 'GO_PORT'],
    ['std::env::var("RUST_KEY")', 'RUST_KEY'],
    ['env!("BUILD_ID")', 'BUILD_ID'],
    ['ProcessInfo.processInfo.environment["APP_MODE"]', 'APP_MODE'],
    ["$_ENV['PHP_KEY']", 'PHP_KEY'],
    ['System.getenv("JAVA_KEY")', 'JAVA_KEY'],
    ['Environment.GetEnvironmentVariable("DOTNET_KEY")', 'DOTNET_KEY'],
    ['System.get_env("ELIXIR_KEY")', 'ELIXIR_KEY'],
  ])('finds %s', (source, name) => {
    expect(reads(source)).toEqual([name]);
  });

  it('handles destructuring and skips Vite built-ins', () => {
    expect(reads("const { HOST, PORT: port = '80', ...rest } = process.env;")).toEqual(['HOST', 'PORT', 'rest']);
    expect(reads('import.meta.env.MODE; import.meta.env.DEV')).toEqual([]);
  });

  it('reports line numbers', () => {
    expect(findEnvReads('\n\nconst a = process.env.A_B;', 'f.ts')).toEqual([{ name: 'A_B', file: 'f.ts', line: 3 }]);
  });
});

describe('parseEnvExample', () => {
  it('reads keys, skipping comments and blank lines', () => {
    const refs = parseEnvExample('# comment\n\nA_KEY=1\nexport B_KEY="x"\n', '.env.example');
    expect(refs.map((r) => `${r.name}:${r.line}`)).toEqual(['A_KEY:3', 'B_KEY:4']);
  });
});

describe('findEnvMentions', () => {
  it('distinguishes strong mentions from weak ones', () => {
    const doc = parseDoc(
      'README.md',
      [
        'Set `DATABASE_URL`, `$HOME_DIR`, `PORT=3000` and `PORT`.',
        'Plain prose MENTIONS_THIS but also HTTP.',
        '',
        '```sh',
        'export TOKEN_A=1',
        'LOG_LEVEL=debug npm start',
        'echo ${CACHE_DIR}',
        '```',
        '',
        '```js',
        'const x = process.env.JS_SETTING;',
        '```',
      ].join('\n'),
    );
    const view = findEnvMentions(doc).map((m) => `${m.name}:${m.strong ? 'strong' : 'weak'}:${m.line}`);
    expect(view).toEqual(
      expect.arrayContaining([
        'DATABASE_URL:strong:1',
        'HOME_DIR:strong:1',
        'PORT:strong:1',
        'PORT:weak:1',
        'MENTIONS_THIS:weak:2',
        'TOKEN_A:strong:5',
        'LOG_LEVEL:strong:6',
        'CACHE_DIR:strong:7',
        'JS_SETTING:strong:11',
      ]),
    );
    expect(view.some((v) => v.startsWith('HTTP'))).toBe(false);
  });
});

describe('env check', () => {
  it('passes when code, .env.example and docs agree across languages', async () => {
    const result = await runFixture('env/good', { only: ['env'] });
    expect(findings(result)).toEqual([]);
    expect(checkResult(result, 'env').checked).toBe(8);
  });

  it('reports undocumented, stale and unused variables', async () => {
    const result = await runFixture('env/drifted', { only: ['env'] });
    expect(summary(findings(result)).sort()).toEqual(
      [
        '.env.example:2 UNUSED_FLAG is listed in .env.example but never read in the source code',
        'README.md:3 LEGACY_MODE is documented but never read in the source code',
        'README.md:6 REMOVED_SETTING is documented but never read in the source code',
        'src/config.ts:3 SIGNING_KEY is read in code but not documented in any Markdown file',
      ].sort(),
    );
    expect(findings(result).find((f) => f.claim === 'UNUSED_FLAG')?.severity).toBe('warning');
  });

  it('respects ignore lists and severity levels', async () => {
    const config = defaultConfig();
    config.env.ignore = ['LEGACY_*', 'REMOVED_SETTING'];
    config.env.undocumented = 'warning';
    config.env.unusedExample = 'off';
    const result = await runClaimCheck({ root: fixture('env/drifted'), config, only: ['env'] });
    // With the unused check off, an unused example entry is still reported as undocumented.
    expect(findings(result).map((f) => `${f.severity} ${f.claim}`)).toEqual(['warning UNUSED_FLAG', 'warning SIGNING_KEY']);
    expect(result.summary.passed).toBe(true);
  });
});
