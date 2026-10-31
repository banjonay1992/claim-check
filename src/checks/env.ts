import { posix } from 'node:path';
import type { Level } from '../config.js';
import { isShellBlock, type DocFile } from '../docs/model.js';
import type { Finding, Severity } from '../types.js';
import { makeTextMatcher } from '../util/glob.js';
import { LineIndex } from '../util/text.js';
import type { Check } from './types.js';

/** Source files scanned for environment variable reads. */
export const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'py', 'rb', 'go', 'rs',
  'swift', 'php', 'java', 'kt', 'kts', 'cs', 'ex', 'exs', 'dart',
]);
/** Extra files that may legitimately mention a variable without "reading" it (compose files, Dockerfiles...). */
const LOOSE_EXTENSIONS = new Set([...CODE_EXTENSIONS, 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml']);
const LOOSE_NAMES = /(^|\/)(Dockerfile|Containerfile|Makefile|Procfile)[^/]*$/;

const NAME = '([A-Za-z_][A-Za-z0-9_]*)';
const Q = `['"\`]`;

/** Patterns for reading an environment variable in common languages. Group 1 is the name. */
const READ_PATTERNS: RegExp[] = [
  new RegExp(`\\bprocess\\.env\\.${NAME}`, 'g'),
  new RegExp(`\\bprocess\\.env\\[\\s*${Q}${NAME}${Q}\\s*\\]`, 'g'),
  new RegExp(`\\bimport\\.meta\\.env\\.${NAME}`, 'g'),
  new RegExp(`\\bimport\\.meta\\.env\\[\\s*${Q}${NAME}${Q}\\s*\\]`, 'g'),
  new RegExp(`\\bDeno\\.env\\.get\\(\\s*${Q}${NAME}${Q}`, 'g'),
  new RegExp(`\\bBun\\.env\\.${NAME}`, 'g'),
  new RegExp(`\\benviron\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`\\benviron\\.get\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\bgetenv\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\bENV\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`\\bENV\\.fetch\\(\\s*['"]${NAME}['"]`, 'g'),
  new RegExp(`\\bos\\.(?:Getenv|LookupEnv)\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`\\benv::var(?:_os)?\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`\\b(?:option_)?env!\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`\\bProcessInfo\\.processInfo\\.environment\\[\\s*"${NAME}"\\s*\\]`, 'g'),
  new RegExp(`\\$_ENV\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`\\bGetEnvironmentVariable\\(\\s*"${NAME}"`, 'g'),
  new RegExp(`\\bPlatform\\.environment\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`\\bSystem\\.(?:get_env|fetch_env!?)\\(\\s*"${NAME}"`, 'g'),
];
const DESTRUCTURE_RE = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:process\.env|import\.meta\.env|Bun\.env)\b/g;
/** Variables Vite defines on import.meta.env itself. */
const VITE_BUILTINS = new Set(['MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL']);

export interface EnvReference {
  name: string;
  file: string;
  line: number;
}

/** Finds environment variable reads in a source file. */
export function findEnvReads(source: string, file: string): EnvReference[] {
  const index = new LineIndex(source);
  const seen = new Set<string>();
  const out: EnvReference[] = [];
  const add = (name: string, offset: number) => {
    const line = index.lineAt(offset);
    const key = `${name}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, file, line });
  };
  for (const pattern of READ_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      if (match[0].startsWith('import.meta.env') && VITE_BUILTINS.has(name)) continue;
      add(name, match.index);
    }
  }
  for (const match of source.matchAll(DESTRUCTURE_RE)) {
    if (match.index === undefined || !match[1]) continue;
    for (const part of match[1].split(',')) {
      const name = /^\s*(?:\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1];
      if (name && !VITE_BUILTINS.has(name)) add(name, match.index);
    }
  }
  return out;
}

/** Reads variable names from a .env-style file. */
export function parseEnvExample(source: string, file: string): EnvReference[] {
  const out: EnvReference[] = [];
  source.split('\n').forEach((line, i) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) out.push({ name: match[1], file, line: i + 1 });
  });
  return out;
}

export interface EnvMention {
  name: string;
  line: number;
  /** Strong mentions are clearly env vars and can be reported as stale; weak ones only count as documentation. */
  strong: boolean;
}

const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const DOTENV_LANGS = new Set(['env', 'dotenv', 'ini', 'properties']);

/** Finds environment variable names mentioned in a document. */
export function findEnvMentions(doc: DocFile): EnvMention[] {
  const out: EnvMention[] = [];
  const push = (name: string, line: number, strong: boolean) => {
    if (name.length < 2 || !ENV_NAME_RE.test(name)) return;
    out.push({ name, line, strong });
  };

  for (const code of doc.inlineCode) {
    const value = code.value.trim();
    const dollar = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(value);
    const assign = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(value);
    if (dollar?.[1]) push(dollar[1], code.line, true);
    else if (assign?.[1]) push(assign[1], code.line, true);
    else if (ENV_NAME_RE.test(value)) push(value, code.line, value.includes('_'));
    else for (const ref of findEnvReads(value, doc.path)) push(ref.name, code.line, true);
  }

  for (const block of doc.codeBlocks) {
    const lang = block.lang?.toLowerCase() ?? '';
    block.value.split('\n').forEach((text, i) => {
      const line = block.contentLine + i;
      if (DOTENV_LANGS.has(lang) || isShellBlock(block)) {
        const assign = /^\s*(?:\$\s+)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(text);
        if (assign?.[1]) push(assign[1], line, true);
      }
      if (isShellBlock(block)) {
        for (const m of text.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]*)=\S/g)) if (m[1]) push(m[1], line, true);
        for (const m of text.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\}?/g)) if (m[1]) push(m[1], line, true);
      }
    });
    for (const ref of findEnvReads(block.value, doc.path)) push(ref.name, block.contentLine + ref.line - 1, true);
  }

  for (const text of doc.text) {
    const lines = text.value.split('\n');
    lines.forEach((value, i) => {
      for (const m of value.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])\b/g)) {
        if (m[1]) push(m[1], text.line + i, false);
      }
    });
  }
  return out;
}

function severityFor(level: Level): Severity | null {
  return level === 'off' ? null : level;
}

function isLooseSource(file: string): boolean {
  const ext = posix.extname(file).slice(1).toLowerCase();
  return LOOSE_EXTENSIONS.has(ext) || LOOSE_NAMES.test(file);
}

export const envCheck: Check = {
  id: 'env',
  title: 'Environment variables',
  description: 'Variables read in code or listed in .env.example are documented, and documented ones are still used.',
  async run({ project, config, docs }) {
    const ignore = makeTextMatcher(config.env.ignore);
    const findings: Finding[] = [];

    const reads = new Map<string, EnvReference>();
    for (const file of project.sourceFiles(CODE_EXTENSIONS)) {
      const source = project.readText(file);
      if (!source) continue;
      for (const ref of findEnvReads(source, file)) if (!reads.has(ref.name)) reads.set(ref.name, ref);
    }

    const examples = new Map<string, EnvReference>();
    for (const name of config.env.exampleFiles) {
      for (const file of project.listFiles().filter((f) => posix.basename(f) === name)) {
        const source = project.readText(file);
        if (!source) continue;
        for (const ref of parseEnvExample(source, file)) if (!examples.has(ref.name)) examples.set(ref.name, ref);
      }
    }

    const documented = new Map<string, { doc: DocFile; mention: EnvMention }[]>();
    for (const doc of docs) {
      for (const mention of findEnvMentions(doc)) {
        const list = documented.get(mention.name) ?? [];
        list.push({ doc, mention });
        documented.set(mention.name, list);
      }
    }

    // Undocumented: read in code or listed in an example file, but never mentioned in the docs.
    const undocumented = severityFor(config.env.undocumented);
    const required = new Map<string, EnvReference>([...examples, ...reads]);
    let checked = 0;
    for (const [name, ref] of required) {
      if (ignore(name)) continue;
      checked++;
      if (documented.has(name) || !undocumented) continue;
      const source = reads.has(name) ? 'read in code' : `listed in ${ref.file}`;
      findings.push({
        check: 'env',
        severity: undocumented,
        file: ref.file,
        line: ref.line,
        claim: name,
        message: `${name} is ${source} but not documented in any Markdown file`,
      });
    }

    // Stale and unused checks need some evidence that source code was scanned at all.
    const stale = severityFor(config.env.stale);
    const unusedExample = severityFor(config.env.unusedExample);
    if (reads.size === 0) return { checked, findings };

    let corpus: string | null = null;
    const appearsInSource = (name: string): boolean => {
      if (reads.has(name)) return true;
      if (corpus === null) {
        corpus = project
          .listFiles()
          .filter((f) => isLooseSource(f) && project.isIgnored(f) === false)
          .filter((f) => !config.env.exampleFiles.includes(posix.basename(f)))
          .map((f) => project.readText(f) ?? '')
          .join('\n');
      }
      return new RegExp(`\\b${name}\\b`).test(corpus);
    };

    for (const [name, uses] of documented) {
      if (ignore(name) || required.has(name)) continue;
      const strong = uses.find((u) => u.mention.strong);
      if (!strong) continue;
      checked++;
      if (!stale || appearsInSource(name)) continue;
      findings.push({
        check: 'env',
        severity: stale,
        file: strong.doc.path,
        line: strong.mention.line,
        claim: name,
        message: `${name} is documented but never read in the source code`,
        hint: 'Remove it from the docs, or add it to env.ignore if it is read somewhere Claim Check cannot see.',
      });
    }

    if (unusedExample) {
      for (const [name, ref] of examples) {
        if (ignore(name) || appearsInSource(name)) continue;
        findings.push({
          check: 'env',
          severity: unusedExample,
          file: ref.file,
          line: ref.line,
          claim: name,
          message: `${name} is listed in ${ref.file} but never read in the source code`,
        });
      }
    }

    return { checked, findings };
  },
};
