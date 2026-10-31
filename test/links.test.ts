import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSkippedHost } from '../src/checks/external.js';
import { defaultConfig } from '../src/config.js';
import { runClaimCheck } from '../src/run.js';
import { checkResult, errors, findings, runFixture, summary } from './helpers.js';

describe('links check', () => {
  it('resolves same-file, cross-file, duplicate, code and HTML anchors', async () => {
    const result = await runFixture('links/good', { only: ['links'] });
    expect(findings(result)).toEqual([]);
    expect(checkResult(result, 'links').checked).toBe(8);
  });

  it('reports missing anchors with a suggestion for likely typos', async () => {
    const result = await runFixture('links/drifted', { only: ['links'] });
    expect(summary(errors(result, 'links'))).toEqual([
      'README.md:3 Anchor "#instalation" not found in README.md',
      'README.md:3 Anchor "#nothing-like-this-heading" not found in README.md',
      'README.md:4 Anchor "#delete-users" not found in docs/api.md',
    ]);
    expect(errors(result, 'links')[0]?.hint).toBe('Did you mean "#installation"?');
  });

  it('leaves missing target files to the paths check', async () => {
    const result = await runFixture('links/drifted', { only: ['paths', 'links'] });
    expect(summary(errors(result, 'paths'))).toEqual(['README.md:5 Link target "docs/gone.md" does not exist']);
  });

  it('does not fetch external URLs unless asked', async () => {
    const result = await runFixture('paths/good', { only: ['links'] });
    expect(checkResult(result, 'links').checked).toBe(0);
  });
});

describe('isSkippedHost', () => {
  it('skips localhost, reserved TLDs and configured hosts', () => {
    const skip = defaultConfig().links.skipHosts;
    expect(isSkippedHost('http://localhost:3000/x', skip)).toBe(true);
    expect(isSkippedHost('https://api.example.com/v1', skip)).toBe(true);
    expect(isSkippedHost('https://my-app.test/', skip)).toBe(true);
    expect(isSkippedHost('https://docs.github.com/', skip)).toBe(false);
  });
});

describe('external links (against a local server)', () => {
  let server: Server;
  let base = '';
  let dir = '';
  let requests = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests++;
      if (req.url === '/ok') res.writeHead(200).end('fine');
      else if (req.url === '/head-not-allowed') res.writeHead(req.method === 'HEAD' ? 405 : 200).end();
      else if (req.url === '/busy') res.writeHead(429).end();
      else if (req.url === '/slow') setTimeout(() => res.writeHead(200).end(), 2000);
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dir = mkdtempSync(join(tmpdir(), 'claim-check-links-'));
    writeFileSync(
      join(dir, 'README.md'),
      [
        '# External',
        '',
        `[ok](${base}/ok)`,
        `[gone](${base}/gone)`,
        `[head](${base}/head-not-allowed)`,
        `[busy](${base}/busy)`,
        `[slow](${base}/slow)`,
        `[ignored](${base}/ignored/page)`,
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const config = () => {
    const c = defaultConfig();
    c.links.skipHosts = [];
    c.links.timeoutMs = 500;
    c.links.ignore = [`${base}/ignored/**`];
    c.links.cacheFile = '.links-cache.json';
    return c;
  };

  it('reports broken links as errors and unconfirmed ones as warnings, then caches', async () => {
    const result = await runClaimCheck({ root: dir, config: config(), only: ['links'], external: true });
    const list = findings(result, 'links').map((f) => `${f.severity} ${f.claim}`);
    expect(list).toEqual([`error ${base}/gone`, `warning ${base}/busy`, `warning ${base}/slow`]);
    expect(checkResult(result, 'links').checked).toBe(5);

    const cache = JSON.parse(readFileSync(join(dir, '.links-cache.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(cache).sort()).toEqual([`${base}/gone`, `${base}/head-not-allowed`, `${base}/ok`]);

    // Cached definite answers are not fetched again; flaky ones are retried.
    const before = requests;
    await runClaimCheck({ root: dir, config: config(), only: ['links'], external: true });
    expect(requests - before).toBe(2);
  });
});
