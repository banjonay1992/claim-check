import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { ALL_CHECKS } from './checks/index.js';
import { SkipCheck } from './checks/types.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { isIgnored } from './docs/model.js';
import type { DocFile } from './docs/model.js';
import { Project } from './project.js';
import type { CheckId, CheckResult, Finding, RunResult, Summary } from './types.js';
import { getVersion } from './version.js';

export interface RunOptions {
  /** Project directory to check. Defaults to the current working directory. */
  root?: string;
  /** Explicit config file path. */
  configPath?: string;
  /** A ready-made config, used instead of loading one from disk. */
  config?: Config;
  /** Run only these checks (overrides the config's "only"). */
  only?: CheckId[];
  /** Skip these checks (added to the config's "skip"). */
  skip?: CheckId[];
  /** Execute runnable command blocks. */
  run?: boolean;
  /** Check external URLs. */
  external?: boolean;
  /** Treat warnings as failures. */
  failOn?: 'error' | 'warning';
}

export class NoDocsError extends Error {
  constructor(root: string) {
    super(`No Markdown files found in ${root} (check the "docs" and "ignore" settings)`);
    this.name = 'NoDocsError';
  }
}

/** Decides which checks run, given the config and command line. */
export function selectChecks(config: Config, only?: CheckId[], skip?: CheckId[]): CheckId[] {
  const wanted = only?.length ? only : (config.only ?? ALL_CHECKS.map((c) => c.id));
  const skipped = new Set([...config.skip, ...(skip ?? [])]);
  return ALL_CHECKS.map((c) => c.id).filter((id) => wanted.includes(id) && !skipped.has(id));
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
  );
}

export function summarise(checks: CheckResult[], failOn: 'error' | 'warning'): Summary {
  const all = checks.flatMap((c) => c.findings);
  const errors = all.filter((f) => f.severity === 'error').length;
  const warnings = all.filter((f) => f.severity === 'warning').length;
  const notes = all.filter((f) => f.severity === 'note').length;
  const checked = checks.reduce((n, c) => n + c.checked, 0);
  const passed = errors === 0 && (failOn === 'error' || warnings === 0);
  return { errors, warnings, notes, checked, passed };
}

/** Runs Claim Check against a project and returns the structured result. */
export async function runClaimCheck(options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const root = resolve(options.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new ConfigError(`Project directory not found: ${options.root ?? root}`);
  }
  const config = options.config ?? loadConfig(root, options.configPath).config;
  const failOn = options.failOn ?? config.failOn;
  const project = new Project(root, config);

  const docPaths = project.docPaths();
  if (docPaths.length === 0) throw new NoDocsError(root);
  const docs = docPaths.map((p) => project.getDoc(p)).filter((d): d is DocFile => d !== null);
  const docsByPath = new Map(docs.map((d) => [d.path, d]));

  const selected = new Set(selectChecks(config, options.only, options.skip));
  const results: CheckResult[] = [];

  for (const check of ALL_CHECKS) {
    const base = { id: check.id, title: check.title };
    if (!selected.has(check.id)) {
      results.push({ ...base, status: 'skipped', durationMs: 0, checked: 0, findings: [], skippedReason: 'not selected' });
      continue;
    }
    const checkStarted = Date.now();
    try {
      const outcome = await check.run({
        project,
        config,
        docs,
        options: { run: options.run ?? false, external: options.external ?? false },
      });
      const findings = sortFindings(
        outcome.findings.filter((f) => {
          const doc = docsByPath.get(f.file);
          return !doc || !isIgnored(doc, f.line, f.check);
        }),
      );
      const failing = findings.some((f) => f.severity === 'error' || (failOn === 'warning' && f.severity === 'warning'));
      results.push({
        ...base,
        status: failing ? 'fail' : 'pass',
        durationMs: Date.now() - checkStarted,
        checked: outcome.checked,
        findings,
      });
    } catch (error) {
      if (!(error instanceof SkipCheck)) throw error;
      results.push({
        ...base,
        status: 'skipped',
        durationMs: Date.now() - checkStarted,
        checked: 0,
        findings: [],
        skippedReason: error.message,
      });
    }
  }

  return {
    root,
    version: getVersion(),
    docs: docPaths,
    checks: results,
    summary: summarise(results, failOn),
    durationMs: Date.now() - started,
  };
}
