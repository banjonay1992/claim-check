import picomatch from 'picomatch';

export type Matcher = (path: string) => boolean;

/**
 * Builds a matcher from glob patterns. A pattern also matches everything below
 * it, so "test/fixtures" ignores the whole directory just as "test/fixtures/**" does.
 */
export function makeMatcher(patterns: readonly string[]): Matcher {
  if (patterns.length === 0) return () => false;
  const expanded = new Set<string>();
  for (const raw of patterns) {
    const pattern = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!pattern) continue;
    expanded.add(pattern);
    if (!pattern.endsWith('/**')) expanded.add(`${pattern}/**`);
  }
  const isMatch = picomatch([...expanded], { dot: true });
  return (path: string) => isMatch(path.replace(/\\/g, '/').replace(/^\.\//, ''));
}

/** Matches plain strings (not paths) against glob patterns, for things like URLs and names. */
export function makeTextMatcher(patterns: readonly string[]): Matcher {
  if (patterns.length === 0) return () => false;
  const isMatch = picomatch([...patterns], { dot: true });
  return (value: string) => patterns.includes(value) || isMatch(value);
}
