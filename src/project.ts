import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { ALWAYS_SKIPPED_DIRS, DEFAULT_IGNORES, type Config } from './config.js';
import type { DocFile } from './docs/model.js';
import { parseDoc } from './docs/parse.js';
import { makeMatcher, type Matcher } from './util/glob.js';
import { isOutsideRoot } from './util/paths.js';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const PROBE = '__claim_check_probe__';

export type ExistsResult = { exists: true } | { exists: false; caseMismatch?: string };

/**
 * A view of the project on disk: file listing, cached reads, exact-case
 * existence checks and lazily parsed documents.
 */
export class Project {
  readonly root: string;
  readonly config: Config;
  private readonly ignored: Matcher;
  private files: string[] | null = null;
  private readonly textCache = new Map<string, string | null>();
  private readonly docCache = new Map<string, DocFile | null>();
  private readonly dirCache = new Map<string, string[] | null>();

  constructor(root: string, config: Config) {
    this.root = resolve(root);
    this.config = config;
    this.ignored = makeMatcher([...DEFAULT_IGNORES, ...config.ignore]);
  }

  isIgnored(rel: string): boolean {
    return this.ignored(rel);
  }

  /** Every non-ignored file in the project, root-relative, sorted. */
  listFiles(): string[] {
    if (this.files) return this.files;
    const out: string[] = [];
    const walk = (relDir: string) => {
      let entries;
      try {
        entries = readdirSync(join(this.root, relDir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (ALWAYS_SKIPPED_DIRS.includes(entry.name)) continue;
          if (this.ignored(rel) || this.ignored(`${rel}/${PROBE}`)) continue;
          walk(rel);
        } else if (entry.isFile()) {
          if (!this.ignored(rel)) out.push(rel);
        }
      }
    };
    walk('');
    out.sort();
    this.files = out;
    return out;
  }

  /** Files matching the given globs (relative to the root), after ignores. */
  filesMatching(patterns: readonly string[]): string[] {
    const match = makeMatcher(patterns);
    return this.listFiles().filter((f) => match(f));
  }

  /** The Markdown documents selected by the config. */
  docPaths(): string[] {
    return this.filesMatching(this.config.docs).filter((f) => /\.(md|markdown)$/i.test(f));
  }

  /** Source files considered by the code-scanning checks. */
  sourceFiles(extensions: ReadonlySet<string>): string[] {
    return this.filesMatching(this.config.source).filter((f) => {
      const ext = posix.extname(f).slice(1).toLowerCase();
      return extensions.has(ext);
    });
  }

  abs(rel: string): string {
    return join(this.root, rel);
  }

  /** Reads a root-relative text file, or returns null if it is missing or too large. */
  readText(rel: string): string | null {
    if (this.textCache.has(rel)) return this.textCache.get(rel) ?? null;
    let text: string | null = null;
    try {
      const abs = this.abs(rel);
      if (statSync(abs).size <= MAX_SOURCE_BYTES) text = readFileSync(abs, 'utf8');
    } catch {
      text = null;
    }
    this.textCache.set(rel, text);
    return text;
  }

  /** Parses a document (cached). Works for documents outside the configured doc set too. */
  getDoc(rel: string): DocFile | null {
    if (this.docCache.has(rel)) return this.docCache.get(rel) ?? null;
    const source = this.readText(rel);
    const doc = source === null ? null : parseDoc(rel, source);
    this.docCache.set(rel, doc);
    return doc;
  }

  isDirectory(rel: string): boolean {
    try {
      return statSync(this.abs(rel)).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Checks that a root-relative path exists with exactly this spelling. On
   * case-insensitive file systems a wrongly cased path would otherwise pass
   * locally and then fail on Linux CI, so the case is verified segment by segment.
   */
  exists(rel: string): ExistsResult {
    const normalised = posix.normalize(rel);
    if (normalised === '.' || normalised === '') return { exists: true };
    if (!existsSync(this.abs(normalised))) {
      const fixed = this.findCaseInsensitive(normalised);
      return fixed ? { exists: false, caseMismatch: fixed } : { exists: false };
    }
    if (isOutsideRoot(normalised)) return { exists: true };
    const fixed = this.findCaseInsensitive(normalised);
    if (fixed && fixed !== normalised) return { exists: false, caseMismatch: fixed };
    return { exists: true };
  }

  private listDir(relDir: string): string[] | null {
    if (this.dirCache.has(relDir)) return this.dirCache.get(relDir) ?? null;
    let names: string[] | null;
    try {
      names = readdirSync(this.abs(relDir || '.'));
    } catch {
      names = null;
    }
    this.dirCache.set(relDir, names);
    return names;
  }

  /** Returns the real spelling of a path if every segment exists ignoring case. */
  private findCaseInsensitive(rel: string): string | null {
    if (isOutsideRoot(rel)) return null;
    const parts = rel.split('/');
    let current = '';
    for (const part of parts) {
      const names = this.listDir(current);
      if (!names) return null;
      const exact = names.find((n) => n === part);
      const loose = exact ?? names.find((n) => n.toLowerCase() === part.toLowerCase());
      if (!loose) return null;
      current = current ? `${current}/${loose}` : loose;
    }
    return current;
  }

  /** Walks up from a folder to the root looking for the first of the given file names. */
  findUp(startDir: string, names: readonly string[]): string | null {
    let dir = startDir;
    for (;;) {
      for (const name of names) {
        const rel = dir ? `${dir}/${name}` : name;
        if (existsSync(this.abs(rel))) return rel;
      }
      if (!dir) return null;
      const parent = posix.dirname(dir);
      dir = parent === '.' ? '' : parent;
    }
  }
}
