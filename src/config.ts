import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { CHECK_IDS, type CheckId } from './types.js';

export type Level = 'error' | 'warning' | 'off';

export interface PathsConfig {
  /** Glob patterns (or exact strings) for claimed paths that should not be checked. */
  ignore: string[];
  /** Whether inline code spans that look like paths are treated as claims. */
  inlineCode: boolean;
}

export interface LinksConfig {
  /** Check external http(s) URLs. Off by default; also enabled by --external. */
  external: boolean;
  timeoutMs: number;
  concurrency: number;
  /** Glob patterns for URLs (or link targets) that should not be checked. */
  ignore: string[];
  /** Cache file for external URL results, relative to the project root. null disables caching. */
  cacheFile: string | null;
  cacheTtlHours: number;
  /** Hosts that are never fetched, such as localhost and the reserved example domains. */
  skipHosts: string[];
}

export interface CommandsConfig {
  timeoutMs: number;
  shell: string;
  /** "copy" (temporary copy of the project), "inplace" (the project itself) or a directory path. */
  workdir: string;
  /** Top-level names left out of the temporary copy. */
  copyExclude: string[];
  /** Symlink the project's node_modules into the temporary copy. */
  linkNodeModules: boolean;
  /** Extra environment variables for executed commands. */
  env: Record<string, string>;
}

export interface EnvConfig {
  ignore: string[];
  exampleFiles: string[];
  undocumented: Level;
  stale: Level;
  unusedExample: Level;
}

export interface ScriptsConfig {
  ignore: string[];
}

export interface EndpointsConfig {
  /** Extra mount prefixes to try when matching documented routes, for example "/api". */
  prefixes: string[];
  ignore: string[];
}

export interface Config {
  docs: string[];
  ignore: string[];
  source: string[];
  only: CheckId[] | null;
  skip: CheckId[];
  failOn: 'error' | 'warning';
  paths: PathsConfig;
  links: LinksConfig;
  commands: CommandsConfig;
  env: EnvConfig;
  scripts: ScriptsConfig;
  endpoints: EndpointsConfig;
}

export const CONFIG_FILE_NAMES = ['claimcheck.config.json', '.claimcheck.json'];

/** Directories that are never walked, whatever the configuration says. */
export const ALWAYS_SKIPPED_DIRS = ['.git', 'node_modules'];

/** Ignore globs that apply in addition to anything the user configures. */
export const DEFAULT_IGNORES = [
  'dist/**',
  'build/**',
  'coverage/**',
  'vendor/**',
  'out/**',
  'target/**',
  '.next/**',
  '.venv/**',
  'venv/**',
  '__pycache__/**',
  '**/CHANGELOG.md',
];

export function defaultConfig(): Config {
  return {
    docs: ['**/*.md', '**/*.markdown'],
    ignore: [],
    source: ['**/*'],
    only: null,
    skip: [],
    failOn: 'error',
    paths: { ignore: [], inlineCode: true },
    links: {
      external: false,
      timeoutMs: 5000,
      concurrency: 8,
      ignore: [],
      cacheFile: '.claim-check-cache.json',
      cacheTtlHours: 24,
      skipHosts: ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'example.com', 'example.org', 'example.net'],
    },
    commands: {
      timeoutMs: 60_000,
      shell: 'bash',
      workdir: 'copy',
      copyExclude: ['.git', 'node_modules'],
      linkNodeModules: true,
      env: {},
    },
    env: {
      ignore: ['NODE_ENV', 'CI', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TMPDIR', 'TERM', 'LANG'],
      exampleFiles: ['.env.example', '.env.sample', '.env.template', '.env.dist'],
      undocumented: 'error',
      stale: 'error',
      unusedExample: 'warning',
    },
    scripts: { ignore: [] },
    endpoints: { prefixes: [], ignore: [] },
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Validator = (value: unknown, path: string) => void;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const stringArray: Validator = (v, p) => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new ConfigError(`${p} must be an array of strings`);
  }
};
const bool: Validator = (v, p) => {
  if (typeof v !== 'boolean') throw new ConfigError(`${p} must be true or false`);
};
const positiveNumber: Validator = (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new ConfigError(`${p} must be a positive number`);
  }
};
const nonEmptyString: Validator = (v, p) => {
  if (typeof v !== 'string' || v.length === 0) throw new ConfigError(`${p} must be a non-empty string`);
};
const oneOf =
  (...allowed: string[]): Validator =>
  (v, p) => {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      throw new ConfigError(`${p} must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
    }
  };
const checkIdArray: Validator = (v, p) => {
  stringArray(v, p);
  for (const id of v as string[]) {
    if (!(CHECK_IDS as readonly string[]).includes(id)) {
      throw new ConfigError(`${p} contains unknown check "${id}" (known checks: ${CHECK_IDS.join(', ')})`);
    }
  }
};
const stringRecord: Validator = (v, p) => {
  if (!isObject(v) || !Object.values(v).every((x) => typeof x === 'string')) {
    throw new ConfigError(`${p} must be an object whose values are strings`);
  }
};
const nullableString: Validator = (v, p) => {
  if (v !== null) nonEmptyString(v, p);
};
const level = oneOf('error', 'warning', 'off');

const section =
  (shape: Record<string, Validator>): Validator =>
  (v, p) => {
    if (!isObject(v)) throw new ConfigError(`${p} must be an object`);
    for (const [key, value] of Object.entries(v)) {
      const validate = shape[key];
      if (!validate) {
        throw new ConfigError(`${p}.${key} is not a known option (expected one of: ${Object.keys(shape).join(', ')})`);
      }
      validate(value, `${p}.${key}`);
    }
  };

const ROOT_SHAPE: Record<string, Validator> = {
  $schema: nonEmptyString,
  docs: stringArray,
  ignore: stringArray,
  source: stringArray,
  only: checkIdArray,
  skip: checkIdArray,
  failOn: oneOf('error', 'warning'),
  paths: section({ ignore: stringArray, inlineCode: bool }),
  links: section({
    external: bool,
    timeoutMs: positiveNumber,
    concurrency: positiveNumber,
    ignore: stringArray,
    cacheFile: nullableString,
    cacheTtlHours: positiveNumber,
    skipHosts: stringArray,
  }),
  commands: section({
    timeoutMs: positiveNumber,
    shell: nonEmptyString,
    workdir: nonEmptyString,
    copyExclude: stringArray,
    linkNodeModules: bool,
    env: stringRecord,
  }),
  env: section({
    ignore: stringArray,
    exampleFiles: stringArray,
    undocumented: level,
    stale: level,
    unusedExample: level,
  }),
  scripts: section({ ignore: stringArray }),
  endpoints: section({ prefixes: stringArray, ignore: stringArray }),
};

/** Validates a raw (parsed JSON) config object and merges it over the defaults. */
export function resolveConfig(raw: unknown, label = 'config'): Config {
  section(ROOT_SHAPE)(raw, label);
  const input = raw as Record<string, unknown>;
  const base = defaultConfig();
  const merged: Config = {
    ...base,
    ...(pick(input, ['docs', 'ignore', 'source', 'only', 'skip', 'failOn']) as Partial<Config>),
    paths: { ...base.paths, ...(input.paths as Partial<PathsConfig> | undefined) },
    links: { ...base.links, ...(input.links as Partial<LinksConfig> | undefined) },
    commands: { ...base.commands, ...(input.commands as Partial<CommandsConfig> | undefined) },
    env: { ...base.env, ...(input.env as Partial<EnvConfig> | undefined) },
    scripts: { ...base.scripts, ...(input.scripts as Partial<ScriptsConfig> | undefined) },
    endpoints: { ...base.endpoints, ...(input.endpoints as Partial<EndpointsConfig> | undefined) },
  };
  return merged;
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

export interface LoadedConfig {
  config: Config;
  /** Absolute path of the file the config came from, or null when defaults were used. */
  file: string | null;
}

/**
 * Loads configuration for a project. An explicit path must exist; otherwise the
 * known file names are looked up in the project root.
 */
export function loadConfig(root: string, explicitPath?: string): LoadedConfig {
  let file: string | null = null;
  if (explicitPath) {
    file = isAbsolute(explicitPath) ? explicitPath : resolve(process.cwd(), explicitPath);
    if (!existsSync(file)) throw new ConfigError(`Config file not found: ${explicitPath}`);
  } else {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = join(root, name);
      if (existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (!file) return { config: defaultConfig(), file: null };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Could not parse ${file}: ${(error as Error).message}`);
  }
  return { config: resolveConfig(raw, configLabel(file)), file };
}

function configLabel(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] ?? 'config';
}
