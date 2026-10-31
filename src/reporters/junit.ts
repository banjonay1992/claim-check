import type { CheckResult, Finding, RunResult } from '../types.js';

export function escapeXml(value: string): string {
  return value
    // Characters that are not allowed in XML 1.0 at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const seconds = (ms: number) => (ms / 1000).toFixed(3);

function testcase(check: CheckResult, f: Finding, failOnWarning: boolean): string {
  const name = `${f.file}:${f.line} ${f.claim ?? f.message}`.split('\n')[0] ?? '';
  const attrs = `classname="claim-check.${check.id}" name="${escapeXml(name)}" file="${escapeXml(f.file)}" line="${f.line}"`;
  const detail = escapeXml([`${f.file}:${f.line}${f.column ? `:${f.column}` : ''}`, f.message, f.hint ?? ''].join('\n').trim());
  if (f.severity === 'error' || (f.severity === 'warning' && failOnWarning)) {
    return `    <testcase ${attrs}>\n      <failure message="${escapeXml(f.message)}" type="${f.severity}">${detail}</failure>\n    </testcase>`;
  }
  if (f.severity === 'note') {
    return `    <testcase ${attrs}>\n      <skipped message="${escapeXml(f.message)}"/>\n    </testcase>`;
  }
  return `    <testcase ${attrs}>\n      <system-out>${escapeXml(`warning: ${f.message}`)}</system-out>\n    </testcase>`;
}

/** JUnit XML: one test suite per check and one test case per finding, for CI test report viewers. */
export function formatJunit(result: RunResult, failOn: 'error' | 'warning' = 'error'): string {
  const failOnWarning = failOn === 'warning';
  const suites: string[] = [];
  let totalTests = 0;
  let totalFailures = 0;
  let totalSkipped = 0;

  for (const check of result.checks) {
    const cases: string[] = [];
    let failures = 0;
    let skipped = 0;
    if (check.status === 'skipped') {
      skipped = 1;
      cases.push(
        `    <testcase classname="claim-check.${check.id}" name="${check.id}">\n      <skipped message="${escapeXml(check.skippedReason ?? 'skipped')}"/>\n    </testcase>`,
      );
    } else {
      for (const f of check.findings) {
        cases.push(testcase(check, f, failOnWarning));
        if (f.severity === 'error' || (failOnWarning && f.severity === 'warning')) failures++;
        if (f.severity === 'note') skipped++;
      }
      const passing = Math.max(0, check.checked - check.findings.length);
      if (passing > 0 || check.findings.length === 0) {
        cases.push(`    <testcase classname="claim-check.${check.id}" name="${passing} claims hold"/>`);
      }
    }
    const tests = cases.length;
    totalTests += tests;
    totalFailures += failures;
    totalSkipped += skipped;
    suites.push(
      `  <testsuite name="${check.id}" tests="${tests}" failures="${failures}" errors="0" skipped="${skipped}" time="${seconds(check.durationMs)}">\n${cases.join('\n')}\n  </testsuite>`,
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="claim-check" tests="${totalTests}" failures="${totalFailures}" errors="0" skipped="${totalSkipped}" time="${seconds(result.durationMs)}">`,
    ...suites,
    '</testsuites>',
    '',
  ].join('\n');
}
