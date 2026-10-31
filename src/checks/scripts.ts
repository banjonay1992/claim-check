import { posix } from 'node:path';
import type { DocFile } from '../docs/model.js';
import { isShellBlock } from '../docs/model.js';
import type { Project } from '../project.js';
import type { Finding } from '../types.js';
import { makeTextMatcher } from '../util/glob.js';
import { closest } from '../util/text.js';
import type { Check } from './types.js';

export type Runner = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'make';

export interface ScriptMention {
  runner: Runner;
  /** Script or target name; null for a bare "make" that relies on the default goal. */
  name: string | null;
  /** Directory given with --prefix, --dir, --cwd or -C, if any. */
  dir?: string;
  /** Makefile given with -f, if any. */
  file?: string;
  line: number;
  column?: number;
}

const NPM_SCRIPT_ALIASES: Record<string, string> = {
  test: 'test', t: 'test', tst: 'test', start: 'start', stop: 'stop', restart: 'restart',
};
const NPM_RUN = new Set(['run', 'run-script', 'rum', 'urn']);
/** Built-in yarn and pnpm commands, so "yarn add" is not mistaken for a script called "add". */
const PM_BUILTINS = new Set([
  'add', 'audit', 'autoclean', 'bin', 'cache', 'check', 'config', 'constraints', 'create', 'dedupe', 'deploy',
  'dlx', 'doctor', 'env', 'exec', 'explain', 'fetch', 'generate-lock-entry', 'global', 'help', 'i', 'import',
  'info', 'init', 'install', 'install-test', 'it', 'licenses', 'link', 'list', 'login', 'logout', 'ls',
  'node', 'npm', 'outdated', 'owner', 'pack', 'patch', 'patch-commit', 'plugin', 'policies', 'prune',
  'publish', 'rebuild', 'remove', 'rm', 'root', 'search', 'server', 'set', 'setup', 'stage', 'store', 'tag',
  'team', 'unlink', 'unplug', 'up', 'update', 'upgrade', 'upgrade-interactive', 'version', 'versions', 'why',
  'workspace', 'workspaces', 'run', 'recursive', '-r',
]);
const SEGMENT_SPLIT = /&&|\|\||;|\||\(|\)|`/;

function clean(token: string): string {
  return token.replace(/^['"]|['"]$/g, '').replace(/[,;)]+$/, '');
}

/** Parses one shell command (already split on && ; |) into a script mention, if it is one. */
function parseCommand(words: string[], line: number, prose: boolean): ScriptMention | null {
  // Drop leading environment assignments and wrappers.
  while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '') || ['sudo', 'env', 'time'].includes(words[0] ?? ''))) {
    words.shift();
  }
  const tool = words.shift();
  if (!tool) return null;
  const strip = (s: string) => (prose ? s.replace(/\.$/, '') : s);

  if (tool === 'npm' || tool === 'pnpm' || tool === 'yarn' || tool === 'bun') {
    let dir: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i] ?? '';
      if (['--prefix', '--dir', '--cwd', '-C'].includes(w)) {
        dir = clean(words[++i] ?? '');
      } else if (/^--(prefix|dir|cwd)=/.test(w)) {
        dir = clean(w.split('=')[1] ?? '');
      } else if (['-w', '--workspace', '--filter', '-F', '--workspaces', '-ws', '--if-present', '-r', '--recursive'].includes(w) || /^--(workspace|filter)=/.test(w)) {
        return null; // workspace-wide or optional runs are not checked yet
      } else {
        rest.push(w);
      }
    }
    const command = rest.find((w) => !w.startsWith('-'));
    if (!command) return null;
    const after = rest.slice(rest.indexOf(command) + 1).find((w) => !w.startsWith('-'));
    let name: string | undefined;

    if (tool === 'npm') {
      if (NPM_RUN.has(command)) name = after;
      else name = NPM_SCRIPT_ALIASES[command];
    } else if (tool === 'bun') {
      if (command === 'run' && after && !/[./]/.test(after)) name = after;
    } else if (command === 'run') {
      name = after;
    } else if (!PM_BUILTINS.has(command) && /^[\w:.-]+$/.test(command)) {
      // "yarn build" and "pnpm build" run the build script.
      if (prose) return null;
      name = command;
    }
    if (!name) return null;
    name = strip(clean(name));
    if (!name || name.startsWith('-')) return null;
    return { runner: tool, name, ...(dir ? { dir } : {}), line };
  }

  if ((tool === 'make' || tool === 'gmake') && !prose) {
    let dir: string | undefined;
    let file: string | undefined;
    const targets: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i] ?? '';
      if (w === '-C' || w === '--directory') dir = clean(words[++i] ?? '');
      else if (w.startsWith('--directory=')) dir = clean(w.slice(12));
      else if (w === '-f' || w === '--file' || w === '--makefile') file = clean(words[++i] ?? '');
      else if (/^--(file|makefile)=/.test(w)) file = clean(w.split('=')[1] ?? '');
      else if (w === '-j' || w === '-l' || w === '-o' || w === '-W') i++;
      else if (w.startsWith('-') || w.includes('=')) continue;
      else if (w === '#' || w.startsWith('#')) break;
      else targets.push(clean(w));
    }
    const base = { runner: 'make' as const, line, ...(dir ? { dir } : {}), ...(file ? { file } : {}) };
    if (targets.length === 0) return { ...base, name: null };
    // Only the first target is reported; extra targets in one call are rare in docs.
    return { ...base, name: targets[0] ?? null };
  }
  return null;
}

/** Finds npm/pnpm/yarn/bun script runs and make targets in a piece of shell text. */
export function findScriptMentions(text: string, firstLine: number, prose = false): ScriptMention[] {
  const out: ScriptMention[] = [];
  text.split('\n').forEach((rawLine, i) => {
    if (!prose && /^\s*#/.test(rawLine)) return;
    const line = rawLine.replace(/^\s*(?:\$|>)\s+/, '');
    for (const segment of line.split(SEGMENT_SPLIT)) {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (prose) {
        // In prose, look for the command anywhere in the sentence.
        for (let start = 0; start < words.length; start++) {
          if (!['npm', 'pnpm', 'yarn', 'bun'].includes(words[start] ?? '')) continue;
          const mention = parseCommand(words.slice(start, start + 6), firstLine + i, true);
          if (mention) out.push(mention);
        }
      } else {
        const mention = parseCommand(words, firstLine + i, false);
        if (mention) out.push(mention);
      }
    }
  });
  return out;
}

/** Collects every script mention in a document, from inline code, shell blocks and prose. */
export function collectMentions(doc: DocFile): ScriptMention[] {
  const out: ScriptMention[] = [];
  for (const code of doc.inlineCode) {
    for (const m of findScriptMentions(code.value, code.line)) out.push({ ...m, column: code.column });
  }
  for (const block of doc.codeBlocks) {
    if (block.lang === null || isShellBlock(block)) out.push(...findScriptMentions(block.value, block.contentLine));
  }
  for (const text of doc.text) out.push(...findScriptMentions(text.value, text.line, true));
  return out;
}

/** Parses target names from a Makefile, following simple include lines. */
export function parseMakeTargets(project: Project, file: string, seen = new Set<string>()): Set<string> {
  const targets = new Set<string>();
  if (seen.has(file)) return targets;
  seen.add(file);
  const source = project.readText(file);
  if (source === null) return targets;
  const dir = posix.dirname(file);
  for (const line of source.replace(/\\\n/g, ' ').split('\n')) {
    if (line.startsWith('\t')) continue;
    const include = /^-?include\s+(.+)$/.exec(line);
    if (include?.[1]) {
      for (const inc of include[1].trim().split(/\s+/)) {
        if (/[$*%]/.test(inc)) continue;
        for (const t of parseMakeTargets(project, posix.normalize(posix.join(dir, inc)), seen)) targets.add(t);
      }
      continue;
    }
    const rule = /^([^\s:#=][^:#=]*?)\s*::?(?!=)/.exec(line);
    if (!rule?.[1]) continue;
    for (const name of rule[1].trim().split(/\s+/)) {
      if (name && !name.includes('$')) targets.add(name);
    }
    // Targets declared .PHONY count as real targets too.
    const phony = /^\.PHONY\s*:\s*(.*)$/.exec(line);
    if (phony?.[1]) for (const name of phony[1].trim().split(/\s+/)) if (name) targets.add(name);
  }
  return targets;
}

function matchesTarget(targets: Set<string>, name: string): boolean {
  if (targets.has(name)) return true;
  for (const t of targets) {
    if (!t.includes('%')) continue;
    const re = new RegExp(`^${t.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
    if (re.test(name)) return true;
  }
  return false;
}

const MAKEFILE_NAMES = ['GNUmakefile', 'makefile', 'Makefile'];

export const scriptsCheck: Check = {
  id: 'scripts',
  title: 'Scripts',
  description: 'npm, pnpm, yarn and bun scripts and make targets mentioned in docs exist.',
  async run({ project, config, docs }) {
    const ignore = makeTextMatcher(config.scripts.ignore);
    const findings: Finding[] = [];
    let checked = 0;
    const scriptCache = new Map<string, Record<string, string> | null | 'invalid'>();

    const readScripts = (pkgFile: string) => {
      if (!scriptCache.has(pkgFile)) {
        const text = project.readText(pkgFile);
        if (text === null) scriptCache.set(pkgFile, null);
        else {
          try {
            const pkg = JSON.parse(text) as { scripts?: Record<string, string> };
            scriptCache.set(pkgFile, pkg.scripts ?? {});
          } catch {
            scriptCache.set(pkgFile, 'invalid');
          }
        }
      }
      return scriptCache.get(pkgFile) ?? null;
    };

    const resolveDir = (doc: DocFile, dir: string | undefined): string => {
      if (!dir) return doc.dir;
      const fromDoc = posix.normalize(posix.join(doc.dir || '.', dir));
      if (project.isDirectory(fromDoc)) return fromDoc === '.' ? '' : fromDoc;
      const fromRoot = posix.normalize(dir);
      return fromRoot === '.' ? '' : fromRoot;
    };

    for (const doc of docs) {
      for (const mention of collectMentions(doc)) {
        const label = mention.name ?? '(default goal)';
        if (mention.name && (ignore(mention.name) || ignore(`${mention.runner} ${mention.name}`))) continue;
        checked++;
        const base = {
          check: 'scripts' as const,
          file: doc.path,
          line: mention.line,
          ...(mention.column ? { column: mention.column } : {}),
          claim: `${mention.runner} ${label}`,
        };
        const startDir = resolveDir(doc, mention.dir);

        if (mention.runner === 'make') {
          const makefile = mention.file
            ? posix.normalize(posix.join(startDir || '.', mention.file))
            : mention.dir
              ? MAKEFILE_NAMES.map((n) => (startDir ? `${startDir}/${n}` : n)).find((f) => project.exists(f).exists) ?? null
              : project.findUp(startDir, MAKEFILE_NAMES);
          if (!makefile || !project.exists(makefile).exists) {
            const command = mention.name ? `make ${mention.name}` : 'make';
            findings.push({ ...base, severity: 'error', message: `"${command}" is documented but no Makefile was found` });
            continue;
          }
          const targets = parseMakeTargets(project, makefile);
          if (mention.name === null) {
            if ([...targets].some((t) => !t.startsWith('.'))) continue;
            findings.push({ ...base, severity: 'error', message: `"make" is documented but ${makefile} has no targets` });
            continue;
          }
          if (matchesTarget(targets, mention.name)) continue;
          const suggestion = closest(mention.name, [...targets].filter((t) => !t.startsWith('.')));
          findings.push({
            ...base,
            severity: 'error',
            message: `Make target "${mention.name}" is not defined in ${makefile}`,
            ...(suggestion ? { hint: `Did you mean "make ${suggestion}"?` } : {}),
          });
          continue;
        }

        const pkgFile = mention.dir
          ? (startDir ? `${startDir}/package.json` : 'package.json')
          : project.findUp(startDir, ['package.json']);
        const scripts = pkgFile ? readScripts(pkgFile) : null;
        if (!pkgFile || scripts === null) {
          findings.push({ ...base, severity: 'error', message: `Script "${label}" is documented but no package.json was found` });
          continue;
        }
        if (scripts === 'invalid') {
          findings.push({ ...base, severity: 'error', message: `${pkgFile} is not valid JSON, so "${label}" cannot be checked` });
          continue;
        }
        const name = mention.name ?? '';
        if (Object.hasOwn(scripts, name)) continue;
        const suggestion = closest(name, Object.keys(scripts));
        findings.push({
          ...base,
          severity: 'error',
          message: `Script "${name}" is not defined in ${pkgFile}`,
          ...(suggestion ? { hint: `Did you mean "${suggestion}"?` } : {}),
        });
      }
    }
    return { checked, findings };
  },
};
