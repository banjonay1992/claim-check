import type { Config } from '../config.js';
import type { DocFile } from '../docs/model.js';
import type { Project } from '../project.js';
import type { CheckId, CheckOutcome } from '../types.js';

export interface CheckOptions {
  /** Execute runnable command blocks (otherwise they are only listed). */
  run: boolean;
  /** Check external http(s) links. */
  external: boolean;
}

export interface CheckContext {
  project: Project;
  config: Config;
  docs: DocFile[];
  options: CheckOptions;
}

/** Thrown by a check that cannot run in this project; the runner marks it as skipped. */
export class SkipCheck extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SkipCheck';
  }
}

export interface Check {
  id: CheckId;
  title: string;
  description: string;
  run(ctx: CheckContext): Promise<CheckOutcome>;
}
