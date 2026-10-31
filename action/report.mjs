// Used by action.yml. Reads the JSON result of a Claim Check run and turns it
// into the log output, workflow annotations, a SARIF file and a job summary.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatReport } from '../dist/index.js';

const env = process.env;
const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const workspace = env.GITHUB_WORKSPACE || process.cwd();

// Findings are relative to the checked folder. Make them relative to the
// workspace so annotations and code scanning point at the right files.
const prefix = path.relative(workspace, result.root).split(path.sep).join('/');
if (prefix && !prefix.startsWith('..')) {
  for (const check of result.checks) {
    for (const finding of check.findings) finding.file = `${prefix}/${finding.file}`;
  }
  result.root = workspace;
}

process.stdout.write(formatReport(result, 'human', { color: true }));

const findings = result.checks.flatMap((check) => check.findings);

if (env.CC_ANNOTATIONS === 'true') {
  const escapeData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escapeProp = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  for (const f of findings) {
    if (f.severity !== 'error' && f.severity !== 'warning') continue;
    const level = f.severity;
    const props = [`file=${escapeProp(f.file)}`, `title=${escapeProp(`Claim Check: ${f.check}`)}`];
    if (f.line) props.push(`line=${f.line}`);
    if (f.column) props.push(`col=${f.column}`);
    const message = f.hint ? `${f.message}\n${f.hint}` : f.message;
    process.stdout.write(`::${level} ${props.join(',')}::${escapeData(message)}\n`);
  }
}

const output = (name, value) => {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
output('errors', result.summary.errors);
output('warnings', result.summary.warnings);

if (env.CC_SARIF) {
  const target = path.resolve(workspace, env.CC_SARIF);
  writeFileSync(target, formatReport(result, 'sarif'));
  output('sarif-file', env.CC_SARIF);
}

if (env.CC_SUMMARY === 'true' && env.GITHUB_STEP_SUMMARY) {
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const { errors, warnings, checked, passed } = result.summary;
  const lines = [
    '## Claim Check',
    '',
    passed
      ? `Docs match the project. ${checked} claims checked in ${result.docs.length} documents.`
      : `Doc drift found: ${errors} errors and ${warnings} warnings across ${checked} claims in ${result.docs.length} documents.`,
    '',
    '| Check | Result | Claims | Errors | Warnings |',
    '| --- | --- | --- | --- | --- |',
    ...result.checks.map((c) => {
      const count = (sev) => c.findings.filter((f) => f.severity === sev).length;
      return `| ${c.id} | ${c.status} | ${c.checked} | ${count('error')} | ${count('warning')} |`;
    }),
  ];
  if (findings.length > 0) {
    const shown = findings.slice(0, 50);
    lines.push('', '| Location | Severity | Finding |', '| --- | --- | --- |');
    for (const f of shown) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`| \`${cell(where)}\` | ${f.severity} | ${cell(f.message)} |`);
    }
    if (findings.length > shown.length) lines.push('', `${findings.length - shown.length} more findings are in the log.`);
  }
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
