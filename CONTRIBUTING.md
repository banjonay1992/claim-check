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
- `action.yml` and `action/report.mjs` are the GitHub Action. The action runs the CLI once with JSON output, and the script turns that into the log, annotations, a SARIF file and the job summary.

## Adding or changing a check

1. Write the check in `src/checks/` and register it in `src/checks/index.ts`. If it needs a new check id, add it to `CHECK_IDS` in `src/types.ts`.
2. Add a passing and a drifted sample project under `test/fixtures/`. Keep fixtures made up and small, with no real names, addresses or secrets.
3. Add tests that assert the exact findings for both, plus unit tests for any heuristics.
4. Describe the check in the README, including what it does not catch.

Prefer missing a claim to reporting a false one. A tool like this is only useful while people trust its failures.

## Planned work

The [roadmap](ROADMAP.md) lists what is planned, and each item has a [GitHub issue](https://github.com/banjonay1992/claim-check/issues?q=is%3Aissue+label%3Aroadmap) with acceptance criteria and a rough estimate, grouped into the `v0.2`, `v0.3` and `Later` milestones. Issues labelled `good first issue` are small and well scoped. If you want to pick one up, say so on the issue first.

## Releasing

Releases are cut from `main` once CI is green.

1. Move the entries under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) to a new version heading with today's date.
2. Bump the version with `npm version 0.2.0 --no-git-tag-version` (using the new version number), which updates `package.json` and `package-lock.json`.
3. Commit, push to `main`, and wait for CI to pass.
4. Create the GitHub release, with the changelog entry as the notes:

   ```sh
   gh release create v0.2.0 --target main --title "v0.2.0" --notes-file notes.md
   ```

5. Move the major version tag that workflows use for the action, so `banjonay1992/claim-check@v0` picks up the release:

   ```sh
   git fetch --tags
   git tag -f v0 v0.2.0
   git push -f origin v0
   ```

### Publishing to npm

Publishing the release creates a GitHub release event, and [the release workflow](.github/workflows/release.yml) then publishes the package to npm with provenance. It uses npm trusted publishing, so no npm token is stored in the repository. The workflow checks that the tag matches the version in `package.json` and runs the type check, the tests and the self-check before it publishes.

The workflow only runs when the repository variable `NPM_PUBLISH` is `true`, so nothing is published until this one-off setup is done:

1. On npmjs.com, open the settings of the `claim-check` package and add a trusted publisher for GitHub Actions with the owner `banjonay1992`, the repository `claim-check` and the workflow file name `release.yml`. If npm will not let you add a trusted publisher before the package exists, publish the first version by hand from a clean checkout of the release tag with `npm publish --access public`, then add the trusted publisher. <!-- claim-check-ignore-line paths -->
2. Set the variable: `gh variable set NPM_PUBLISH --body true -R banjonay1992/claim-check`.

The name `claim-check` was free on npm when this was written. If it is taken by the time of the first release, use the scoped name `@banjonay1992/claim-check` instead: change `name` in `package.json`, the import in the README's programmatic example and the install commands, and keep the `claim-check` command name in `bin`.

## Style

- TypeScript in strict mode. `npm run typecheck` must be clean.
- Docs are written in plain British English. Please do not use em dashes or en dashes.
- Commit messages say what changed and why, in the imperative ("Add make include support").
