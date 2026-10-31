import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_CHECKS } from './checks/index.js';
import { ConfigError } from './config.js';
import { FORMATS, formatReport, type Format } from './reporters/index.js';
import { NoDocsError, runClaimCheck } from './run.js';
import { CHECK_IDS, type CheckId } from './types.js';
import { getVersion } from './version.js';

export interface Io {
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
  cwd: string;
  env: Record<string, string | undefined>;
}

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_USAGE = 2;

export const HELP = `Usage: claim-check [dir] [options]

Checks that a project's README and other Markdown docs still match the
project: paths, links, scripts, environment variables, endpoints and
runnable commands.

Options:
  -c, --config <file>    Config file (default: claimcheck.config.json in dir)
      --only <checks>    Run only these checks, comma-separated
      --skip <checks>    Skip these checks, comma-separated
      --run              Execute shell blocks marked claim-check:run
      --external         Also check external http(s) links
  -f, --format <name>    Report format: human, json, junit or sarif
      --json             Shorthand for --format json
  -o, --output <file>    Write the report to a file instead of stdout
      --fail-on <level>  Fail on "error" (default) or also on "warning"
  -q, --quiet            Only show errors in the human report
      --no-color         Turn off coloured output
      --list-checks      List the available checks and exit
  -h, --help             Show this help and exit
  -v, --version          Show the version and exit

Checks: ${CHECK_IDS.join(', ')}

Exit codes: 0 docs match, 1 doc drift found, 2 usage or configuration error
`;

class UsageError extends Error {}

function parseCheckList(value: string | undefined, flag: string): CheckId[] | undefined {
  if (value === undefined) return undefined;
  const ids = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    if (!(CHECK_IDS as readonly string[]).includes(id)) {
      throw new UsageError(`Unknown check "${id}" in ${flag} (known checks: ${CHECK_IDS.join(', ')})`);
    }
  }
  return ids as CheckId[];
}

function useColor(io: Io, flags: { noColor: boolean; toFile: boolean; format: Format }): boolean {
  if (flags.noColor || flags.toFile || flags.format !== 'human') return false;
  if (io.env.NO_COLOR) return false;
  if (io.env.FORCE_COLOR && io.env.FORCE_COLOR !== '0') return true;
  return io.stdout.isTTY === true;
}

/** Entry point shared by the bin script and the tests. Returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: 'string', short: 'c' },
        only: { type: 'string' },
        skip: { type: 'string' },
        run: { type: 'boolean' },
        external: { type: 'boolean' },
        format: { type: 'string', short: 'f' },
        json: { type: 'boolean' },
        output: { type: 'string', short: 'o' },
        'fail-on': { type: 'string' },
        quiet: { type: 'boolean', short: 'q' },
        'no-color': { type: 'boolean' },
        'list-checks': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    io.stderr.write(`claim-check: ${(error as Error).message}\nRun "claim-check --help" for usage.\n`);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    io.stdout.write(HELP);
    return EXIT_OK;
  }
  if (values.version) {
    io.stdout.write(`${getVersion()}\n`);
    return EXIT_OK;
  }
  if (values['list-checks']) {
    const width = Math.max(...ALL_CHECKS.map((c) => c.id.length));
    for (const check of ALL_CHECKS) io.stdout.write(`${check.id.padEnd(width)}  ${check.description}\n`);
    return EXIT_OK;
  }

  try {
    if (positionals.length > 1) throw new UsageError(`Expected at most one directory, got ${positionals.length}`);
    const format = (values.json ? 'json' : (values.format ?? 'human')) as Format;
    if (!FORMATS.includes(format)) {
      throw new UsageError(`Unknown format "${values.format}" (expected one of: ${FORMATS.join(', ')})`);
    }
    if (values.json && values.format && values.format !== 'json') {
      throw new UsageError('--json cannot be combined with a different --format');
    }
    const failOn = values['fail-on'];
    if (failOn !== undefined && failOn !== 'error' && failOn !== 'warning') {
      throw new UsageError(`--fail-on must be "error" or "warning", got "${failOn}"`);
    }

    const root = resolve(io.cwd, positionals[0] ?? '.');
    const only = parseCheckList(values.only, '--only');
    const skip = parseCheckList(values.skip, '--skip');
    const result = await runClaimCheck({
      root,
      ...(values.config ? { configPath: resolve(io.cwd, values.config) } : {}),
      ...(only ? { only } : {}),
      ...(skip ? { skip } : {}),
      run: values.run ?? false,
      external: values.external ?? false,
      ...(failOn ? { failOn } : {}),
    });

    const color = useColor(io, { noColor: values['no-color'] ?? false, toFile: !!values.output, format });
    const report = formatReport(result, format, {
      color,
      quiet: values.quiet ?? false,
      failOn: failOn ?? (result.summary.passed || result.summary.errors > 0 ? 'error' : 'warning'),
    });

    if (values.output) {
      const target = resolve(io.cwd, values.output);
      writeFileSync(target, report);
      const { errors, warnings } = result.summary;
      io.stderr.write(`claim-check: wrote ${format} report to ${values.output} (${errors} errors, ${warnings} warnings)\n`);
    } else {
      io.stdout.write(report);
    }
    return result.summary.passed ? EXIT_OK : EXIT_DRIFT;
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof NoDocsError) {
      io.stderr.write(`claim-check: ${error.message}\n`);
      return EXIT_USAGE;
    }
    io.stderr.write(`claim-check: unexpected error: ${(error as Error).stack ?? String(error)}\n`);
    return EXIT_USAGE;
  }
}
