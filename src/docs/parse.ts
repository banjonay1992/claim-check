import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';
import type { Nodes, Parents, Root, RootContent } from 'mdast';
import { posix } from 'node:path';
import { CHECK_IDS, type CheckId } from '../types.js';
import type { DocCodeBlock, DocFile, IgnoreRange, RunDirective } from './model.js';

const IGNORE_RE = /^<!--\s*claim-check-ignore(?:-(start|end|line|next))?(?:\s+([\w,\s-]*?))?\s*-->$/i;
const RUN_RE = /^<!--\s*claim-check:run\b([^>]*?)-->$/i;
const ANCHOR_ATTR_RE = /\s(?:id|name)\s*=\s*["']([^"']+)["']/gi;
const URL_ATTR_RE = /\s(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const EXPLICIT_ID_RE = /\s*\{#([\w-]+)\}\s*$/;

/** Parses a Markdown document into the shared doc model. */
export function parseDoc(path: string, source: string): DocFile {
  const tree = fromMarkdown(source, {
    extensions: [gfm(), frontmatter(['yaml', 'toml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml', 'toml'])],
  });

  const dir = posix.dirname(path);
  const doc: DocFile = {
    path,
    dir: dir === '.' ? '' : dir,
    source,
    headings: [],
    anchors: new Set(),
    links: [],
    inlineCode: [],
    codeBlocks: [],
    text: [],
    ignores: [],
  };

  const slugger = new GithubSlugger();
  const openRegions: { line: number; checks: Set<CheckId> | null }[] = [];
  const lastLine = source.split('\n').length;

  const visit = (node: Nodes, parent: Parents | null, index: number): void => {
    const line = node.position?.start.line ?? 1;
    const column = node.position?.start.column ?? 1;

    switch (node.type) {
      case 'heading': {
        let text = toString(node);
        const explicit = EXPLICIT_ID_RE.exec(text);
        if (explicit?.[1]) {
          doc.anchors.add(explicit[1]);
          text = text.replace(EXPLICIT_ID_RE, '');
        }
        const slug = slugger.slug(text);
        doc.headings.push({ depth: node.depth, text, slug, line, column });
        doc.anchors.add(slug);
        break;
      }
      case 'link':
      case 'image':
      case 'definition':
        doc.links.push({ kind: node.type, url: node.url, line, column });
        break;
      case 'inlineCode':
        doc.inlineCode.push({ value: node.value, line, column });
        break;
      case 'text':
        doc.text.push({ value: node.value, line, column });
        break;
      case 'code':
        doc.codeBlocks.push(makeCodeBlock(node, source));
        break;
      case 'html':
        handleHtml(node.value, line, column, parent, index);
        break;
      default:
        break;
    }

    if ('children' in node) {
      node.children.forEach((child, i) => visit(child as Nodes, node as Parents, i));
    }
  };

  const handleHtml = (value: string, line: number, column: number, parent: Parents | null, index: number) => {
    const trimmed = value.trim();

    for (const match of value.matchAll(ANCHOR_ATTR_RE)) {
      if (match[1]) doc.anchors.add(match[1]);
    }
    for (const match of value.matchAll(URL_ATTR_RE)) {
      if (!match[1] || match.index === undefined) continue;
      const before = value.slice(0, match.index);
      const extraLines = before.split('\n').length - 1;
      doc.links.push({ kind: 'html', url: match[1], line: line + extraLines, column: extraLines ? 1 : column });
    }

    const ignore = IGNORE_RE.exec(trimmed);
    if (ignore) {
      const mode = ignore[1]?.toLowerCase();
      const checks = parseCheckList(ignore[2]);
      const isBlock = parent?.type === 'root' || parent?.type === 'listItem' || parent?.type === 'blockquote';
      if (mode === 'start') {
        openRegions.push({ line, checks });
      } else if (mode === 'end') {
        const open = openRegions.pop();
        if (open) doc.ignores.push({ startLine: open.line, endLine: line, checks: open.checks });
      } else if (mode === 'line' || !isBlock) {
        doc.ignores.push({ startLine: line, endLine: line, checks });
      } else {
        const next = nextSibling(parent, index);
        const end = next?.position?.end.line ?? line + 1;
        doc.ignores.push({ startLine: line, endLine: end, checks });
      }
      return;
    }

    const run = RUN_RE.exec(trimmed);
    if (run) {
      const next = nextSibling(parent, index);
      if (next?.type === 'code') pendingRun.set(next, parseRunOptions(run[1] ?? ''));
    }
  };

  const pendingRun = new Map<RootContent, RunDirective>();
  visit(tree as Root, null, 0);

  // Attach directives found in comments to the code blocks that follow them.
  for (const [node, directive] of pendingRun) {
    const block = doc.codeBlocks.find((b) => b.line === node.position?.start.line);
    if (block && !block.run) block.run = directive;
  }

  for (const open of openRegions) {
    doc.ignores.push({ startLine: open.line, endLine: lastLine, checks: open.checks });
  }

  return doc;
}

function nextSibling(parent: Parents | null, index: number): RootContent | undefined {
  if (!parent) return undefined;
  return parent.children[index + 1] as RootContent | undefined;
}

function parseCheckList(raw: string | undefined): Set<CheckId> | null {
  if (!raw || !raw.trim()) return null;
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is CheckId => (CHECK_IDS as readonly string[]).includes(s));
  return ids.length ? new Set(ids) : null;
}

function makeCodeBlock(node: Extract<Nodes, { type: 'code' }>, source: string): DocCodeBlock {
  const line = node.position?.start.line ?? 1;
  const endLine = node.position?.end.line ?? line;
  const firstLine = source.split('\n')[line - 1] ?? '';
  const fenced = /^\s*(```|~~~)/.test(firstLine);
  const block: DocCodeBlock = {
    lang: node.lang ?? null,
    meta: node.meta ?? null,
    value: node.value,
    line,
    column: node.position?.start.column ?? 1,
    contentLine: fenced ? line + 1 : line,
    endLine,
  };
  const meta = node.meta ?? '';
  const marker = /(?:^|\s)claim-check:run\b(.*)$/i.exec(meta);
  if (marker) block.run = parseRunOptions(marker[1] ?? '');
  return block;
}

/** Parses "timeout=30s exit=1 cwd=examples" style options. */
export function parseRunOptions(raw: string): RunDirective {
  const directive: RunDirective = { expectExit: 0 };
  for (const token of raw.trim().split(/\s+/)) {
    const [key, value] = token.split('=', 2);
    if (!key || value === undefined) continue;
    switch (key.toLowerCase()) {
      case 'timeout': {
        const ms = parseDuration(value);
        if (ms !== null) directive.timeoutMs = ms;
        break;
      }
      case 'exit': {
        const code = Number.parseInt(value, 10);
        if (Number.isInteger(code)) directive.expectExit = code;
        break;
      }
      case 'cwd':
        directive.cwd = value;
        break;
      default:
        break;
    }
  }
  return directive;
}

/** Parses "500ms", "30s", "2m" or a bare number of seconds. */
export function parseDuration(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const n = Number.parseFloat(match[1]);
  switch (match[2]) {
    case 'ms':
      return Math.round(n);
    case 'm':
      return Math.round(n * 60_000);
    default:
      return Math.round(n * 1000);
  }
}

export type { IgnoreRange };
