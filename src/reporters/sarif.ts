import { ALL_CHECKS } from '../checks/index.js';
import type { RunResult } from '../types.js';

/**
 * SARIF 2.1.0 output, which GitHub code scanning and other tools can show
 * inline on pull requests. Notes (such as runnable blocks that were not run)
 * are left out so they do not clutter code scanning.
 */
export function formatSarif(result: RunResult): string {
  const rules = ALL_CHECKS.map((check) => ({
    id: check.id,
    name: check.title.replace(/\s+/g, ''),
    shortDescription: { text: check.description },
  }));

  const results = result.checks
    .flatMap((c) => c.findings)
    .filter((f) => f.severity !== 'note')
    .map((f) => ({
      ruleId: f.check,
      ruleIndex: rules.findIndex((r) => r.id === f.check),
      level: f.severity === 'error' ? 'error' : 'warning',
      message: { text: f.hint ? `${f.message}\n${f.hint}` : f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.file, uriBaseId: '%SRCROOT%' },
            region: { startLine: Math.max(1, f.line), ...(f.column ? { startColumn: f.column } : {}) },
          },
        },
      ],
      partialFingerprints: { claimCheck: `${f.check}:${f.file}:${f.claim ?? f.message}` },
    }));

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'claim-check',
            version: result.version,
            rules,
          },
        },
        originalUriBaseIds: { '%SRCROOT%': { uri: `file://${result.root.replace(/\\/g, '/').replace(/\/?$/, '/')}` } },
        results,
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
