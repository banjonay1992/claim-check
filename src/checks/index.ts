import type { CheckId } from '../types.js';
import { commandsCheck } from './commands.js';
import { endpointsCheck } from './endpoints.js';
import { envCheck } from './env.js';
import { linksCheck } from './links.js';
import { pathsCheck } from './paths.js';
import { scriptsCheck } from './scripts.js';
import type { Check } from './types.js';

/** Every check, in the order they run and are reported. */
export const ALL_CHECKS: readonly Check[] = [pathsCheck, linksCheck, scriptsCheck, envCheck, endpointsCheck, commandsCheck];

export function getCheck(id: CheckId): Check {
  const check = ALL_CHECKS.find((c) => c.id === id);
  if (!check) throw new Error(`Unknown check: ${id}`);
  return check;
}

export type { Check, CheckContext, CheckOptions } from './types.js';
