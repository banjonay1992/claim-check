import { describe, expect, it } from 'vitest';
import { classifyPath } from '../src/checks/paths.js';
import { checkResult, errors, runFixture, summary } from './helpers.js';

describe('classifyPath', () => {
  it.each([
    ['./scripts/setup.sh', 'strict'],
    ['../README.md', 'strict'],
    ['src/', 'strict'],
    ['src/index.ts', 'strict'],
    ['.github/workflows/ci.yml', 'strict'],
    ['package.json', 'bare'],
    ['Makefile', 'bare'],
    ['.env.example', 'bare'],
    ['src/components', 'soft'],
  ] as const)('treats %s as %s', (value, kind) => {
    expect(classifyPath(value)).toBe(kind);
  });

  it.each([
    'Node.js',
    'Vue.js',
    'v1.2.3',
    '.env',
    '.env.local',
    'dist/app.js',
    'node_modules/foo/index.js',
    'node:fs',
    '--flag',
    '@scope/pkg',
    '/api/users',
    'https://example.com/a.md',
    'npm run build',
    'process.env.PORT',
    'useState',
    'a | b',
    '*.md',
  ])('does not treat %s as a path', (value) => {
    expect(classifyPath(value)).toBeNull();
  });
});

describe('paths check', () => {
  it('passes when every referenced path exists', async () => {
    const result = await runFixture('paths/good', { only: ['paths'] });
    expect(errors(result)).toEqual([]);
    expect(checkResult(result, 'paths').checked).toBe(12);
    expect(result.summary.passed).toBe(true);
  });

  it('reports missing link targets, inline paths, images, HTML links and wrong case', async () => {
    const result = await runFixture('paths/drifted', { only: ['paths'] });
    expect(summary(errors(result, 'paths'))).toEqual([
      'README.md:3 Link target "./docs/setup.md" does not exist',
      'README.md:5 Path "src/old-name.ts" does not exist',
      'README.md:5 Path "src/lib/" does not exist',
      'README.md:7 Link target "Docs/Guide.md" does not exist with this exact case',
      'README.md:9 Image target "images/screenshot.png" does not exist',
      'README.md:11 HTML link target "CONTRIBUTING.md" does not exist',
    ]);
    const caseFinding = errors(result, 'paths')[3];
    expect(caseFinding?.hint).toContain('docs/guide.md');
    expect(caseFinding?.column).toBe(22);
    expect(result.summary.passed).toBe(false);
  });
});
