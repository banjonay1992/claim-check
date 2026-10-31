import { posix, relative, sep } from 'node:path';

/** Converts an OS path to a forward-slash path. */
export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** Relative path from root to an absolute path, in forward-slash form. */
export function relPath(root: string, abs: string): string {
  return toPosix(relative(root, abs));
}

/**
 * Joins a path claimed inside a document (relative to the document's folder)
 * onto that folder, returning a normalised root-relative path.
 * A leading slash means "relative to the project root", as on GitHub.
 */
export function resolveClaimedPath(docDir: string, target: string): string {
  if (target.startsWith('/')) return posix.normalize(target.replace(/^\/+/, '')) || '.';
  const joined = posix.normalize(posix.join(docDir || '.', target));
  return joined === '' ? '.' : joined;
}

/** True when a normalised root-relative path climbs above the root. */
export function isOutsideRoot(rel: string): boolean {
  return rel === '..' || rel.startsWith('../');
}
