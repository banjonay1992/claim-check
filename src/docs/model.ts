import type { CheckId } from '../types.js';

/** A position inside a document. Lines and columns are 1-based. */
export interface Position {
  line: number;
  column: number;
}

export interface DocHeading extends Position {
  depth: number;
  text: string;
  slug: string;
}

export type LinkKind = 'link' | 'image' | 'definition' | 'html';

export interface DocLink extends Position {
  kind: LinkKind;
  url: string;
}

export interface DocInlineCode extends Position {
  value: string;
}

export interface DocText extends Position {
  value: string;
}

/** Options attached to a runnable code block through its info string or a directive comment. */
export interface RunDirective {
  timeoutMs?: number;
  expectExit: number;
  cwd?: string;
}

export interface DocCodeBlock extends Position {
  lang: string | null;
  meta: string | null;
  value: string;
  /** Line of the first line of code (after the opening fence). */
  contentLine: number;
  endLine: number;
  /** Present when the block is marked as runnable. */
  run?: RunDirective;
}

/** A range of lines where some (or all) checks are switched off by a directive. */
export interface IgnoreRange {
  startLine: number;
  endLine: number;
  /** null means every check. */
  checks: Set<CheckId> | null;
}

/** Everything Claim Check knows about one Markdown document. */
export interface DocFile {
  /** Root-relative path with forward slashes. */
  path: string;
  /** Root-relative folder of the document ('' for the root). */
  dir: string;
  source: string;
  headings: DocHeading[];
  /** Every anchor a link could target: heading slugs plus HTML id and name attributes. */
  anchors: Set<string>;
  links: DocLink[];
  inlineCode: DocInlineCode[];
  codeBlocks: DocCodeBlock[];
  text: DocText[];
  ignores: IgnoreRange[];
}

export const SHELL_LANGS = new Set(['sh', 'bash', 'shell', 'zsh', 'console', 'shellsession', 'shell-session']);

export function isShellBlock(block: DocCodeBlock): boolean {
  return block.lang !== null && SHELL_LANGS.has(block.lang.toLowerCase());
}

/** True when a finding at this line should be suppressed for the given check. */
export function isIgnored(doc: DocFile, line: number, check: CheckId): boolean {
  return doc.ignores.some(
    (r) => line >= r.startLine && line <= r.endLine && (r.checks === null || r.checks.has(check)),
  );
}
