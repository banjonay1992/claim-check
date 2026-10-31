import { describe, expect, it } from 'vitest';
import { findScriptMentions } from '../src/checks/scripts.js';
import { checkResult, errors, runFixture, summary } from './helpers.js';

const names = (text: string, prose = false) =>
  findScriptMentions(text, 1, prose).map((m) => `${m.runner}:${m.name ?? '(default)'}${m.dir ? `@${m.dir}` : ''}`);

describe('findScriptMentions', () => {
  it('understands npm, pnpm, yarn and bun', () => {
    expect(names('npm run build && npm test')).toEqual(['npm:build', 'npm:test']);
    expect(names('npm run-script lint -- --fix')).toEqual(['npm:lint']);
    expect(names('pnpm run dev')).toEqual(['pnpm:dev']);
    expect(names('pnpm dev')).toEqual(['pnpm:dev']);
    expect(names('yarn lint:fix')).toEqual(['yarn:lint:fix']);
    expect(names('bun run seed')).toEqual(['bun:seed']);
    expect(names('npm --prefix web run dev')).toEqual(['npm:dev@web']);
  });

  it('skips built-ins, optional runs, workspaces and non-script commands', () => {
    expect(names('npm install && npm ci && yarn add react && pnpm install')).toEqual([]);
    expect(names('npm run --if-present maybe')).toEqual([]);
    expect(names('npm run build -w packages/app')).toEqual([]);
    expect(names('bun run src/index.ts')).toEqual([]);
    expect(names('npm run')).toEqual([]);
  });

  it('understands make with flags, directories and variables', () => {
    expect(names('make')).toEqual(['make:(default)']);
    expect(names('make -j4 build VERBOSE=1')).toEqual(['make:build']);
    expect(names('make -C tools gen')).toEqual(['make:gen@tools']);
    expect(names('$ make test')).toEqual(['make:test']);
  });

  it('ignores shell comments and is conservative in prose', () => {
    expect(names('# make sure you have node installed')).toEqual([]);
    expect(names('Then run npm run build.', true)).toEqual(['npm:build']);
    expect(names('Make sure yarn is installed', true)).toEqual([]);
    expect(names('use yarn build to compile', true)).toEqual([]);
  });
});

describe('scripts check', () => {
  it('passes when every script and target exists', async () => {
    const result = await runFixture('scripts/good', { only: ['scripts'] });
    expect(errors(result)).toEqual([]);
    expect(checkResult(result, 'scripts').checked).toBe(11);
  });

  it('reports missing scripts and targets with suggestions', async () => {
    const result = await runFixture('scripts/drifted', { only: ['scripts'] });
    expect(summary(errors(result))).toEqual([
      'README.md:3 Script "deploy" is not defined in package.json',
      'README.md:3 Script "biuld" is not defined in package.json',
      'README.md:6 Make target "release" is not defined in Makefile',
      'README.md:7 Make target "nope" is not defined in tools/Makefile',
      'README.md:8 Script "dev" is not defined in web/package.json',
    ]);
    expect(errors(result)[1]?.hint).toBe('Did you mean "build"?');
  });
});
