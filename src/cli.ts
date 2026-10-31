#!/usr/bin/env node
import { main } from './main.js';

const code = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  env: process.env,
});
process.exitCode = code;
