/** Maps character offsets in a string to 1-based line numbers. */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  lineAt(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  columnAt(offset: number): number {
    return offset - (this.starts[this.lineAt(offset) - 1] ?? 0) + 1;
  }
}

/** Classic edit distance, used to suggest the closest match for a typo. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

/** Returns the candidate closest to the input, if it is close enough to be a likely typo. */
export function closest(input: string, candidates: Iterable<string>, maxDistance = 3): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const limit = Math.min(maxDistance, Math.max(2, Math.ceil(input.length / 3)));
  return bestScore <= limit ? best : null;
}

/** Safe decodeURIComponent that returns the input unchanged if it is malformed. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits a link target into its path and fragment, dropping any query string. */
export function splitTarget(url: string): { path: string; fragment: string | null } {
  const hash = url.indexOf('#');
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? null : url.slice(hash + 1);
  const query = beforeHash.indexOf('?');
  const path = query === -1 ? beforeHash : beforeHash.slice(0, query);
  return { path: safeDecode(path), fragment: fragment === null ? null : safeDecode(fragment) };
}

/** True for targets with a URL scheme (http:, mailto:, data: and so on) or protocol-relative URLs. */
export function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/** Tail of a block of output, limited to a number of lines. */
export function tail(text: string, lines: number): string {
  const all = text.replace(/\s+$/, '').split('\n');
  return all.slice(-lines).join('\n');
}
