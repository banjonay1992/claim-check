import { describe, expect, it } from 'vitest';
import { isIgnored } from '../src/docs/model.js';
import { parseDoc, parseDuration, parseRunOptions } from '../src/docs/parse.js';

describe('parseDoc', () => {
  it('collects headings with GitHub-style slugs, including duplicates', () => {
    const doc = parseDoc(
      'README.md',
      ['# Hello World', '## Example', '## Example', '## `claim-check` options', '## Custom {#my-id}'].join('\n\n'),
    );
    expect(doc.headings.map((h) => h.slug)).toEqual([
      'hello-world',
      'example',
      'example-1',
      'claim-check-options',
      'custom',
    ]);
    expect(doc.anchors.has('my-id')).toBe(true);
    expect(doc.headings[1]?.line).toBe(3);
  });

  it('collects links, images, definitions and HTML links with positions', () => {
    const doc = parseDoc(
      'docs/guide.md',
      [
        'See [one](a.md) and ![img](b.png).',
        '',
        '<a id="anchor-here" href="c.md">c</a>',
        '',
        '[ref]: d.md',
      ].join('\n'),
    );
    expect(doc.dir).toBe('docs');
    expect(doc.links.map((l) => [l.kind, l.url, l.line])).toEqual([
      ['link', 'a.md', 1],
      ['image', 'b.png', 1],
      ['html', 'c.md', 3],
      ['definition', 'd.md', 5],
    ]);
    expect(doc.anchors.has('anchor-here')).toBe(true);
  });

  it('records inline code, text and code blocks with content lines', () => {
    const doc = parseDoc('README.md', 'Run `npm test` now.\n\n```sh\necho hi\n```\n');
    expect(doc.inlineCode).toEqual([{ value: 'npm test', line: 1, column: 5 }]);
    expect(doc.text[0]?.value).toBe('Run ');
    expect(doc.codeBlocks[0]).toMatchObject({ lang: 'sh', value: 'echo hi', line: 3, contentLine: 4, endLine: 5 });
    expect(doc.codeBlocks[0]?.run).toBeUndefined();
  });

  it('marks runnable blocks from the info string and from a directive comment', () => {
    const doc = parseDoc(
      'README.md',
      [
        '```sh claim-check:run timeout=5s exit=2',
        'exit 2',
        '```',
        '',
        '<!-- claim-check:run cwd=examples -->',
        '```bash',
        'ls',
        '```',
      ].join('\n'),
    );
    expect(doc.codeBlocks[0]?.run).toEqual({ expectExit: 2, timeoutMs: 5000 });
    expect(doc.codeBlocks[1]?.run).toEqual({ expectExit: 0, cwd: 'examples' });
  });

  it('skips YAML front matter', () => {
    const doc = parseDoc('README.md', '---\ntitle: `not/a/path.md`\n---\n\n# Title\n');
    expect(doc.inlineCode).toEqual([]);
    expect(doc.headings[0]?.slug).toBe('title');
  });

  it('understands every form of ignore directive', () => {
    const doc = parseDoc(
      'README.md',
      [
        '<!-- claim-check-ignore -->', // 1
        'ignored paragraph', // 2
        '',
        'one line `x` <!-- claim-check-ignore-line -->', // 4
        '',
        '<!-- claim-check-ignore-start paths, env -->', // 6
        'region', // 7
        '<!-- claim-check-ignore-end -->', // 8
        '',
        'not ignored', // 10
      ].join('\n'),
    );
    expect(isIgnored(doc, 2, 'paths')).toBe(true);
    expect(isIgnored(doc, 4, 'scripts')).toBe(true);
    expect(isIgnored(doc, 7, 'paths')).toBe(true);
    expect(isIgnored(doc, 7, 'env')).toBe(true);
    expect(isIgnored(doc, 7, 'scripts')).toBe(false);
    expect(isIgnored(doc, 10, 'paths')).toBe(false);
  });

  it('treats an unclosed ignore region as running to the end of the file', () => {
    const doc = parseDoc('README.md', 'a\n\n<!-- claim-check-ignore-start -->\n\nb\n\nc\n');
    expect(isIgnored(doc, 7, 'links')).toBe(true);
    expect(isIgnored(doc, 1, 'links')).toBe(false);
  });
});

describe('run options', () => {
  it('parses durations', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('10')).toBe(10_000);
    expect(parseDuration('soon')).toBeNull();
  });

  it('ignores unknown or malformed options', () => {
    expect(parseRunOptions('exit=abc colour=blue timeout=')).toEqual({ expectExit: 0 });
  });
});
