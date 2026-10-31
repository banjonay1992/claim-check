import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import type { CommandsConfig } from '../config.js';
import { isShellBlock, type DocCodeBlock, type DocFile } from '../docs/model.js';
import type { Finding } from '../types.js';
import { tail } from '../util/text.js';
import type { Check } from './types.js';

const OUTPUT_LIMIT = 16 * 1024;

/**
 * Turns a code block into a script. Console-style blocks (lines starting with
 * "$ ") keep only the prompt lines and their continuations, dropping output.
 */
export function extractScript(block: DocCodeBlock): string {
  const lines = block.value.split('\n');
  const lang = block.lang?.toLowerCase() ?? '';
  const consoleStyle =
    ['console', 'shellsession', 'shell-session'].includes(lang) || lines.some((l) => /^\s*\$ /.test(l));
  if (!consoleStyle) return block.value;

  const out: string[] = [];
  let continuing = false;
  for (const line of lines) {
    const prompt = /^\s*\$ (.*)$/.exec(line);
    if (prompt) {
      out.push(prompt[1] ?? '');
      continuing = (prompt[1] ?? '').trimEnd().endsWith('\\');
    } else if (continuing) {
      out.push(line);
      continuing = line.trimEnd().endsWith('\\');
    }
  }
  return out.join('\n');
}

export interface ExecResult {
  code: number | null;
  timedOut: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

/** Runs a script in its own process group so a timeout can stop everything it started. */
export function execScript(
  script: string,
  cwd: string,
  config: Pick<CommandsConfig, 'shell' | 'env'>,
  timeoutMs: number,
): Promise<ExecResult> {
  const started = Date.now();
  const shellName = config.shell.split(/[\\/]/).pop() ?? config.shell;
  const flags = ['bash', 'zsh'].includes(shellName) ? ['-e', '-o', 'pipefail', '-c'] : ['-e', '-c'];
  return new Promise((resolvePromise) => {
    let output = '';
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
    };
    const child = spawn(config.shell, [...flags, script], {
      cwd,
      env: { ...process.env, ...config.env, CLAIM_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ code: null, timedOut, output, error: error.message, durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, timedOut, output, durationMs: Date.now() - started });
    });
  });
}

/** Creates the working directory commands run in, and a function to clean it up. */
function prepareWorkdir(root: string, config: CommandsConfig): { dir: string; cleanup: () => void } {
  if (config.workdir === 'inplace') return { dir: root, cleanup: () => {} };
  if (config.workdir !== 'copy') {
    const dir = resolve(root, config.workdir);
    if (!existsSync(dir)) throw new Error(`commands.workdir "${config.workdir}" does not exist`);
    return { dir, cleanup: () => {} };
  }
  const dir = mkdtempSync(join(tmpdir(), 'claim-check-'));
  const excluded = new Set(config.copyExclude);
  cpSync(root, dir, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => {
      const rel = relative(root, src);
      if (!rel) return true;
      const top = rel.split(sep)[0] ?? '';
      return !excluded.has(top);
    },
  });
  if (config.linkNodeModules && excluded.has('node_modules') && existsSync(join(root, 'node_modules'))) {
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function firstLine(script: string): string {
  const line = script.split('\n').find((l) => l.trim()) ?? '';
  const more = script.trim().split('\n').length > 1 ? ' ...' : '';
  return `${line.trim()}${more}`;
}

function formatSeconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

export const commandsCheck: Check = {
  id: 'commands',
  title: 'Commands',
  description: 'Shell blocks marked as runnable exit as expected (listed only, unless --run is given).',
  async run({ project, config, docs, options }) {
    const findings: Finding[] = [];
    const blocks: { doc: DocFile; block: DocCodeBlock }[] = [];
    for (const doc of docs) {
      for (const block of doc.codeBlocks) if (block.run) blocks.push({ doc, block });
    }
    if (blocks.length === 0) return { checked: 0, findings };

    const runnable = blocks.filter(({ doc, block }) => {
      if (block.lang === null || isShellBlock(block)) return true;
      findings.push({
        check: 'commands',
        severity: 'warning',
        file: doc.path,
        line: block.line,
        message: `Only shell blocks can be run; this block is marked runnable but its language is "${block.lang}"`,
      });
      return false;
    });

    if (!options.run) {
      for (const { doc, block } of runnable) {
        findings.push({
          check: 'commands',
          severity: 'note',
          file: doc.path,
          line: block.line,
          claim: extractScript(block),
          message: `Runnable block not executed (pass --run to execute): ${firstLine(extractScript(block))}`,
        });
      }
      return { checked: runnable.length, findings };
    }

    let workdir: { dir: string; cleanup: () => void };
    try {
      workdir = prepareWorkdir(project.root, config.commands);
    } catch (error) {
      const first = runnable[0];
      findings.push({
        check: 'commands',
        severity: 'error',
        file: first?.doc.path ?? '',
        line: first?.block.line ?? 1,
        message: `Could not prepare a working directory: ${(error as Error).message}`,
      });
      return { checked: 0, findings };
    }

    try {
      for (const { doc, block } of runnable) {
        const directive = block.run ?? { expectExit: 0 };
        const script = extractScript(block);
        const timeoutMs = directive.timeoutMs ?? config.commands.timeoutMs;
        const cwd = directive.cwd ? resolve(workdir.dir, directive.cwd) : workdir.dir;
        const base = { check: 'commands' as const, file: doc.path, line: block.line, claim: script };

        if (!existsSync(cwd)) {
          findings.push({ ...base, severity: 'error', message: `Working directory "${directive.cwd}" does not exist` });
          continue;
        }
        const result = await execScript(script, cwd, config.commands, timeoutMs);
        const output = tail(result.output, 15);
        const hint = output ? `Last output:\n${output}` : undefined;

        if (result.timedOut) {
          findings.push({
            ...base,
            severity: 'error',
            message: `Command timed out after ${formatSeconds(timeoutMs)}: ${firstLine(script)}`,
            ...(hint ? { hint } : {}),
          });
        } else if (result.error) {
          findings.push({
            ...base,
            severity: 'error',
            message: `Could not start ${config.commands.shell}: ${result.error}`,
          });
        } else if (result.code !== directive.expectExit) {
          findings.push({
            ...base,
            severity: 'error',
            message: `Command exited with code ${result.code ?? 'null'} (expected ${directive.expectExit}): ${firstLine(script)}`,
            ...(hint ? { hint } : {}),
          });
        }
      }
    } finally {
      workdir.cleanup();
    }
    return { checked: runnable.length, findings };
  },
};
