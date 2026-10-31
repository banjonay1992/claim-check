/**
 * Shared types used across the doc model, checks, reporters and CLI.
 */

export const CHECK_IDS = ['paths', 'links', 'commands', 'env', 'scripts', 'endpoints'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type Severity = 'error' | 'warning' | 'note';

/** A single problem (or note) found while checking a claim. */
export interface Finding {
  check: CheckId;
  severity: Severity;
  /** File path relative to the project root, using forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number, when known. */
  column?: number;
  message: string;
  /** The literal text of the claim, for example a path or a script name. */
  claim?: string;
  /** Optional suggestion for fixing the problem. */
  hint?: string;
}

export interface CheckOutcome {
  /** Number of individual claims the check looked at. */
  checked: number;
  findings: Finding[];
}

export interface CheckResult extends CheckOutcome {
  id: CheckId;
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  durationMs: number;
  /** Reason the check was skipped, if it was. */
  skippedReason?: string;
}

export interface Summary {
  errors: number;
  warnings: number;
  notes: number;
  checked: number;
  passed: boolean;
}

export interface RunResult {
  root: string;
  version: string;
  docs: string[];
  checks: CheckResult[];
  summary: Summary;
  durationMs: number;
}
