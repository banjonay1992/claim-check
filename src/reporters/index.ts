import type { RunResult } from '../types.js';
import { formatHuman } from './human.js';
import { formatJunit } from './junit.js';
import { formatSarif } from './sarif.js';

export const FORMATS = ['human', 'json', 'junit', 'sarif'] as const;
export type Format = (typeof FORMATS)[number];

export interface FormatOptions {
  color?: boolean;
  quiet?: boolean;
  failOn?: 'error' | 'warning';
}

export function formatReport(result: RunResult, format: Format, options: FormatOptions = {}): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(result, null, 2)}\n`;
    case 'junit':
      return formatJunit(result, options.failOn);
    case 'sarif':
      return formatSarif(result);
    default:
      return formatHuman(result, { color: options.color ?? false, quiet: options.quiet ?? false });
  }
}

export { formatHuman, formatJunit, formatSarif };
