import { readFileSync, writeFileSync } from 'node:fs';
import type { LinksConfig } from '../config.js';

export interface UrlResult {
  ok: boolean;
  status: number | null;
  /** 'broken' fails the check, 'flaky' is reported as a warning (timeouts, 429, 5xx, network errors). */
  outcome: 'ok' | 'broken' | 'flaky';
  detail: string;
  checkedAt: number;
}

type Cache = Record<string, UrlResult>;

const RESERVED_TLDS = new Set(['test', 'invalid', 'localhost', 'example', 'local', 'internal']);

/** True for hosts that should never be fetched (local, reserved or configured). */
export function isSkippedHost(url: string, skipHosts: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  const tld = host.split('.').pop() ?? '';
  if (RESERVED_TLDS.has(tld)) return true;
  return skipHosts.some((h) => {
    const skip = h.toLowerCase();
    return host === skip || host.endsWith(`.${skip}`);
  });
}

function readCache(file: string | null): Cache {
  if (!file) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(file: string | null, cache: Cache): void {
  if (!file) return;
  try {
    writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // A cache that cannot be written is not worth failing the run over.
  }
}

async function request(url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<Response> {
  return fetch(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'claim-check (documentation link checker)', accept: '*/*' },
  });
}

function classify(status: number): UrlResult['outcome'] {
  if (status < 400) return 'ok';
  if (status === 429 || status >= 500) return 'flaky';
  return 'broken';
}

/** Checks one URL with HEAD, falling back to GET for servers that reject HEAD. */
export async function checkUrl(url: string, timeoutMs: number): Promise<UrlResult> {
  const now = Date.now();
  try {
    let response = await request(url, 'HEAD', timeoutMs);
    if ([403, 404, 405, 501].includes(response.status)) {
      response = await request(url, 'GET', timeoutMs);
      await response.body?.cancel();
    }
    const outcome = classify(response.status);
    return { ok: outcome === 'ok', status: response.status, outcome, detail: `HTTP ${response.status}`, checkedAt: now };
  } catch (error) {
    const err = error as Error & { cause?: { code?: string } };
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    const detail = timedOut ? `timed out after ${timeoutMs}ms` : (err.cause?.code ?? err.message);
    return { ok: false, status: null, outcome: 'flaky', detail, checkedAt: now };
  }
}

/** Checks a set of URLs with a concurrency limit, reusing cached results that are still fresh. */
export async function checkUrls(
  urls: readonly string[],
  config: LinksConfig,
  cacheFile: string | null,
): Promise<Map<string, UrlResult>> {
  const cache = readCache(cacheFile);
  const ttl = config.cacheTtlHours * 3_600_000;
  const results = new Map<string, UrlResult>();
  const queue: string[] = [];

  for (const url of urls) {
    const cached = cache[url];
    // Only definite answers are cached; flaky results are always retried.
    if (cached && cached.outcome !== 'flaky' && Date.now() - cached.checkedAt < ttl) results.set(url, cached);
    else queue.push(url);
  }

  const workers = Array.from({ length: Math.max(1, Math.min(config.concurrency, queue.length)) }, async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const result = await checkUrl(url, config.timeoutMs);
      results.set(url, result);
      if (result.outcome !== 'flaky') cache[url] = result;
    }
  });
  await Promise.all(workers);
  writeCache(cacheFile, cache);
  return results;
}
