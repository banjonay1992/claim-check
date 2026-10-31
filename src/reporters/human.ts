import type { CheckResult, Finding, RunResult, Severity } from '../types.js';

export interface HumanOptions {
  color: boolean;
  /** Only show errors. */
  quiet: boolean;
}

const codes = { red: 31, yellow: 33, green: 32, cyan: 36, dim: 2, bold: 1 } as const;
type Style = keyof typeof codes;

function painter(enabled: boolean) {
  return (style: Style, text: string) => (enabled ? `\u001b[${codes[style]}m${text}\u001b[0m` : text);
}

const SEVERITY_STYLE: Record<Severity, Style> = { error: 'red', warning: 'yellow', note: 'cyan' };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function checkLine(check: CheckResult, paint: ReturnType<typeof painter>, width: number): string {
  const name = check.id.padEnd(width);
  if (check.status === 'skipped') {
    return `  ${name}  ${paint('dim', `skipped (${check.skippedReason ?? 'not selected'})`)}`;
  }
  const errors = check.findings.filter((f) => f.severity === 'error').length;
  const warnings = check.findings.filter((f) => f.severity === 'warning').length;
  const notes = check.findings.filter((f) => f.severity === 'note').length;
  const status = check.status === 'pass' ? paint('green', 'pass') : paint('red', 'fail');
  const parts = [plural(check.checked, 'claim')];
  if (errors) parts.push(paint('red', plural(errors, 'error')));
  if (warnings) parts.push(paint('yellow', plural(warnings, 'warning')));
  if (notes) parts.push(paint('cyan', plural(notes, 'note')));
  return `  ${name}  ${status}  ${parts.join(', ')}`;
}

/** Formats a result in the style of a linter: findings grouped by file, then a per-check summary. */
export function formatHuman(result: RunResult, options: HumanOptions): string {
  const paint = painter(options.color);
  const out: string[] = [];
  const visible = (f: Finding) => !options.quiet || f.severity === 'error';
  const findings = result.checks.flatMap((c) => c.findings).filter(visible);

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(paint('bold', file));
    list.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
    const locWidth = Math.max(...list.map((f) => location(f).length));
    for (const f of list) {
      const severity = paint(SEVERITY_STYLE[f.severity], f.severity.padEnd(7));
      out.push(`  ${paint('dim', location(f).padEnd(locWidth))}  ${severity}  ${f.message}  ${paint('dim', f.check)}`);
      if (f.hint) {
        const indent = ' '.repeat(locWidth + 13);
        for (const line of f.hint.split('\n')) out.push(`${indent}${paint('dim', line)}`);
      }
    }
    out.push('');
  }

  const width = Math.max(...result.checks.map((c) => c.id.length));
  out.push(paint('bold', 'Checks'));
  for (const check of result.checks) out.push(checkLine(check, paint, width));
  out.push('');

  const { errors, warnings, notes, checked, passed } = result.summary;
  const counts = [plural(errors, 'error'), plural(warnings, 'warning')];
  if (notes) counts.push(plural(notes, 'note'));
  const scope = `across ${plural(checked, 'claim')} in ${plural(result.docs.length, 'document')}`;
  const verdict = passed ? paint('green', 'Docs match the project.') : paint('red', 'Doc drift found.');
  out.push(`${verdict} ${counts.join(', ')} ${scope} (${result.durationMs}ms)`);

  const commands = result.checks.find((c) => c.id === 'commands');
  if (commands && commands.findings.some((f) => f.severity === 'note')) {
    out.push(paint('dim', 'Runnable blocks were listed but not executed. Pass --run to execute them.'));
  }
  return `${out.join('\n')}\n`;
}

function location(f: Finding): string {
  return f.column ? `${f.line}:${f.column}` : `${f.line}`;
}
