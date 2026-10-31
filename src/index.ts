/**
 * Programmatic API for Claim Check. The CLI is a thin layer over these.
 */
export { runClaimCheck, selectChecks, type RunOptions } from './run.js';
export { loadConfig, resolveConfig, defaultConfig, ConfigError, type Config } from './config.js';
export { formatReport, FORMATS, type Format } from './reporters/index.js';
export { parseDoc } from './docs/parse.js';
export { ALL_CHECKS } from './checks/index.js';
export type { DocFile } from './docs/model.js';
export type { CheckId, CheckResult, Finding, RunResult, Severity, Summary } from './types.js';
