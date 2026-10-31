# Contributing

Thanks for taking the time to help. Claim Check is small on purpose, so the bar for a change is that it makes the reports more accurate or more useful without making them noisier.

## Setting up

You need Node.js 22.12 or newer and `bash`.

```sh
npm ci
npm run typecheck
npm test
npm run self-check
```

`npm run self-check` builds the tool and runs it against this repository's own docs. It must pass before a change is merged, so if you change the README, run it.

## How the code is laid out

- `src/docs/` parses each Markdown file once into a shared document model (headings, anchors, links, inline code, code blocks, text and ignore directives).
- `src/project.ts` lists files, applies ignores, caches reads and checks that paths exist with the exact case.
- `src/checks/` has one module per check. Each exports an object with an `id`, a `title`, a `description` and an async `run` function that returns findings.
- `src/reporters/` turns a run result into the human, JUnit and SARIF formats. JSON is the result itself.
- `src/main.ts` is the CLI, and `src/cli.ts` is the small entry point that calls it.

## Adding or changing a check

1. Write the check in `src/checks/` and register it in `src/checks/index.ts`. If it needs a new check id, add it to `CHECK_IDS` in `src/types.ts`.
2. Add a passing and a drifted sample project under `test/fixtures/`. Keep fixtures made up and small, with no real names, addresses or secrets.
3. Add tests that assert the exact findings for both, plus unit tests for any heuristics.
4. Describe the check in the README, including what it does not catch.

Prefer missing a claim to reporting a false one. A tool like this is only useful while people trust its failures.

## Style

- TypeScript in strict mode. `npm run typecheck` must be clean.
- Docs are written in plain British English. Please do not use em dashes.
- Commit messages say what changed and why, in the imperative ("Add make include support").
