import { posix } from 'node:path';
import type { DocFile } from '../docs/model.js';
import type { Project } from '../project.js';
import type { Finding } from '../types.js';
import { makeTextMatcher } from '../util/glob.js';
import { hasScheme, splitTarget } from '../util/text.js';
import { resolveClaimedPath } from '../util/paths.js';
import type { Check } from './types.js';

/** File extensions that make an inline code span read as a file name. */
const KNOWN_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'xml', 'csv', 'tsv', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts',
  'cts', 'tsx', 'vue', 'svelte', 'astro', 'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c',
  'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'graphql', 'gql', 'proto', 'lock',
  'env', 'example', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'ipynb', 'gradle', 'xcconfig',
  'plist', 'entitlements', 'storyboard', 'xib', 'pbxproj', 'dart', 'ex', 'exs', 'erl', 'lua', 'r', 'jl',
  'tf', 'hcl', 'nix', 'cmake', 'mk',
]);

/** Extensionless file names that are clearly files. */
const KNOWN_BARE_NAMES = new Set([
  'Makefile', 'GNUmakefile', 'Dockerfile', 'Containerfile', 'LICENSE', 'LICENCE', 'NOTICE', 'Procfile',
  'Gemfile', 'Rakefile', 'Brewfile', 'Justfile', 'justfile', 'Vagrantfile', 'CODEOWNERS', 'Podfile',
  'Cartfile', 'Pipfile', 'Jenkinsfile', 'Caddyfile',
]);

/** Paths that are usually created by the reader (builds, installs, local env files), not committed. */
const GENERATED_ROOTS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'target', '.next', '.nuxt', '.svelte-kit', '.turbo',
  '__pycache__', 'venv', '.venv', 'env', '.cache', 'tmp', 'DerivedData', 'Pods',
]);
const LOCAL_FILE_RE = /^\.env(\.[\w-]+)?\.local$|^\.env$/;

const REJECT_CHARS = /[\s*?<>{}$|=(),;'"`[\]!^%#~\\:&]/;

export type PathKind = 'strict' | 'bare' | 'soft';

/**
 * Decides whether an inline code span reads as a file or directory path.
 * - strict: explicit relative paths, directories with a trailing slash and
 *   multi-segment paths ending in a known file name
 * - bare: a single file name such as `package.json`
 * - soft: multi-segment paths without an extension; only checked when the
 *   first segment exists, to avoid treating things like owner/repo as paths
 */
export function classifyPath(raw: string): PathKind | null {
  const value = raw.trim();
  if (!value || value.length > 200) return null;
  if (value.startsWith('@') || value.startsWith('-') || value.startsWith('/')) return null;
  if (value.includes('://') || REJECT_CHARS.test(value)) return null;
  if (value === '.' || value === '..' || value === './' || value === '../') return null;

  const explicit = value.startsWith('./') || value.startsWith('../');
  const segments = value.split('/').filter((s) => s.length > 0 && s !== '.' && s !== '..');
  if (segments.length === 0) return null;
  if (!segments.every((s) => /^[\w.+@-]+$/.test(s))) return null;

  const first = segments[0] ?? '';
  const last = segments[segments.length - 1] ?? '';
  if (GENERATED_ROOTS.has(first) || LOCAL_FILE_RE.test(last)) return null;
  if (explicit || value.endsWith('/')) return 'strict';

  const ext = posix.extname(last).slice(1);
  const looksLikeFile =
    KNOWN_BARE_NAMES.has(last) ||
    (ext !== '' && KNOWN_EXTENSIONS.has(ext.toLowerCase())) ||
    (last.startsWith('.') && last.length > 1 && /^\.[\w.-]+$/.test(last));

  if (segments.length === 1) {
    if (!looksLikeFile) return null;
    // Product names such as Node.js or Vue.js are not files.
    if (/^[A-Z][A-Za-z0-9]*\.js$/.test(last)) return null;
    // Version-like strings such as v1.2.ts are unlikely; plain numbers too.
    if (/^v?\d+(\.\d+)+$/.test(last)) return null;
    return 'bare';
  }
  return looksLikeFile ? 'strict' : 'soft';
}

function describe(project: Project, rel: string, claim: string): { message: string; hint?: string } | null {
  const result = project.exists(rel);
  if (result.exists) return null;
  if (result.caseMismatch) {
    return {
      message: `"${claim}" does not exist with this exact case`,
      hint: `Found "${result.caseMismatch}". Paths are case-sensitive on Linux and in most CI.`,
    };
  }
  return { message: `"${claim}" does not exist` };
}

export const pathsCheck: Check = {
  id: 'paths',
  title: 'Paths',
  description: 'Files and directories referenced by links and inline code exist.',
  async run({ project, config, docs }) {
    const ignore = makeTextMatcher(config.paths.ignore);
    const findings: Finding[] = [];
    let checked = 0;

    for (const doc of docs) {
      for (const link of doc.links) {
        const url = link.url.trim();
        if (!url || url.startsWith('#') || hasScheme(url) || url.includes('{{')) continue;
        const { path } = splitTarget(url);
        if (!path) continue;
        const rel = resolveClaimedPath(doc.dir, path);
        if (ignore(path) || ignore(rel)) continue;
        checked++;
        const problem = describe(project, rel, path);
        if (problem) {
          findings.push({
            check: 'paths',
            severity: 'error',
            file: doc.path,
            line: link.line,
            column: link.column,
            claim: path,
            message: `${linkLabel(link.kind)} target ${problem.message}`,
            ...(problem.hint ? { hint: problem.hint } : {}),
          });
        }
      }

      if (!config.paths.inlineCode) continue;
      for (const code of doc.inlineCode) {
        const value = code.value.trim();
        const kind = classifyPath(value);
        if (!kind || ignore(value)) continue;
        const candidates = candidatesFor(doc, value);
        if (kind === 'soft') {
          const first = value.replace(/^\.\//, '').split('/')[0] ?? '';
          const anchorDirs = [resolveClaimedPath(doc.dir, first), first];
          if (!anchorDirs.some((d) => project.isDirectory(d))) continue;
        }
        if (candidates.some((c) => ignore(c))) continue;
        checked++;
        if (candidates.some((c) => project.exists(c).exists)) continue;
        // Report against the root-relative reading, which is how most READMEs mean it.
        const primary = candidates[candidates.length - 1] ?? value;
        const problem = describe(project, primary, value) ?? { message: `"${value}" does not exist` };
        findings.push({
          check: 'paths',
          severity: 'error',
          file: doc.path,
          line: code.line,
          column: code.column,
          claim: value,
          message: `Path ${problem.message}`,
          ...(problem.hint ? { hint: problem.hint } : {}),
        });
      }
    }
    return { checked, findings };
  },
};

/** Inline paths may be written relative to the document or to the project root. */
function candidatesFor(doc: DocFile, value: string): string[] {
  const explicit = value.startsWith('./') || value.startsWith('../');
  const fromDoc = resolveClaimedPath(doc.dir, value);
  if (explicit || !doc.dir) return [fromDoc];
  return [fromDoc, resolveClaimedPath('', value)];
}

function linkLabel(kind: string): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'definition':
      return 'Link definition';
    case 'html':
      return 'HTML link';
    default:
      return 'Link';
  }
}
