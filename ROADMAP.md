# Roadmap

This is the planned work after the first release, in rough order. Estimates are for one person and include tests and docs. They add up to a little over 100 hours, so the "Next" section alone is a solid few weeks of evenings. Each item has a GitHub issue with acceptance criteria, and each section is a milestone.

## Next (milestone [v0.2](https://github.com/banjonay1992/claim-check/milestone/1))

These close the most obvious gaps in the first release.

1. **Workspace-aware scripts (about 5 hours, [#1](https://github.com/banjonay1992/claim-check/issues/1)).** Read `workspaces` from the root `package.json` and `pnpm-workspace.yaml`, then resolve `npm run build -w packages/app`, `pnpm --filter app build` and `yarn workspace app build` against the right package. Today these are skipped. <!-- claim-check-ignore-line paths -->
2. **JSON Schema for the config file (about 2 hours, [#2](https://github.com/banjonay1992/claim-check/issues/2)).** Publish a schema generated from the same definitions the validator uses, so editors offer completion and catch typos before a run.
3. **Path suggestions (about 2 hours, [#3](https://github.com/banjonay1992/claim-check/issues/3)).** When a path is missing, suggest the closest existing file, for example after a rename from `src/old-name.ts` to `src/new-name.ts`, using the file list the project index already has. <!-- claim-check-ignore-line paths -->
4. **Opt-in path checks in shell blocks (about 4 hours, [#4](https://github.com/banjonay1992/claim-check/issues/4)).** Look at the arguments of `cd`, `cat`, `cp`, `ls`, `source` and `./script` lines in shell blocks, behind a `paths.codeBlocks` setting, since these are a common source of drift. <!-- claim-check-ignore-line paths -->
5. **A composite GitHub Action (done in 0.1.0, [#5](https://github.com/banjonay1992/claim-check/issues/5)).** `action.yml` builds and runs Claim Check, annotates findings, writes a short summary to the job summary page and writes a SARIF file, so a workflow needs one step.
6. **First npm release (about 3 hours, [#6](https://github.com/banjonay1992/claim-check/issues/6)).** The package name is free and the release workflow with npm provenance is in place. What is left is setting up trusted publishing on npm, testing the installed `claim-check` binary on Linux and macOS in CI, and publishing.
7. **`claim-check init` (about 3 hours, [#7](https://github.com/banjonay1992/claim-check/issues/7)).** Run all checks once, then write a starter config that ignores fixture and vendored folders it found, so adoption on a large repository starts green.

## Then (milestone [v0.3](https://github.com/banjonay1992/claim-check/milestone/2))

These make existing checks smarter or the output more useful.

8. **Markdown reporter (about 3 hours, [#8](https://github.com/banjonay1992/claim-check/issues/8)).** A compact report suitable for a pull request comment or the GitHub job summary, grouped by file with links to lines.
9. **Changed-files mode (about 4 hours, [#9](https://github.com/banjonay1992/claim-check/issues/9)).** A `--changed <ref>` option that only reports findings in documents changed since a git ref, for pre-commit hooks and large repositories with existing drift.
10. **curl examples and OpenAPI as sources for endpoints (about 6 hours, [#10](https://github.com/banjonay1992/claim-check/issues/10)).** Treat `curl -X POST http://localhost:3000/api/items` as an endpoint claim, and accept an OpenAPI file as the source of truth when it exists.
11. **Config-schema aware env check (about 6 hours, [#11](https://github.com/banjonay1992/claim-check/issues/11)).** Recognise variables declared through zod or envalid schemas, pydantic `BaseSettings` fields, Viper bindings and the `environment` sections of compose files, which would remove the most common false "undocumented" and "stale" reports.
12. **Better external link checking (about 4 hours, [#12](https://github.com/banjonay1992/claim-check/issues/12)).** Respect `Retry-After`, limit concurrency per host, check fragments on external HTML pages, and allow per-host headers for documentation sites that block unknown user agents.
13. **Windows support for commands (about 5 hours, [#13](https://github.com/banjonay1992/claim-check/issues/13)).** Run `powershell` and `pwsh` blocks with the right flags, kill process trees on timeout without process groups, and run the test suite on Windows in CI.
14. **Optional container sandbox for commands (about 5 hours, [#14](https://github.com/banjonay1992/claim-check/issues/14)).** A `commands.image` setting that runs blocks with `docker run` against the temporary copy, for projects that want stronger isolation than a temporary folder.

## Later (milestone [Later](https://github.com/banjonay1992/claim-check/milestone/3))

Larger pieces that need more design first.

15. **Version claims (about 4 hours, [#15](https://github.com/banjonay1992/claim-check/issues/15)).** Compare Node.js, Python or Go versions stated in the README with `engines`, `.nvmrc`, `.python-version` or `go.mod`, and versions in install commands with the package version. <!-- claim-check-ignore-line paths -->
16. **CLI flag claims (about 5 hours, [#16](https://github.com/banjonay1992/claim-check/issues/16)).** For projects that ship a CLI, compare documented `--flags` with the output of the tool's own `--help`, run in the same sandbox as commands.
17. **More document formats (about 8 hours, [#17](https://github.com/banjonay1992/claim-check/issues/17)).** MDX through the mdast MDX extension first, then reStructuredText and AsciiDoc if there is demand.
18. **Plugin API for custom checks (about 6 hours, [#18](https://github.com/banjonay1992/claim-check/issues/18)).** Load extra checks from the config so teams can verify claims specific to their stack, using the same document model and reporters.
19. **Performance on large monorepos (about 5 hours, [#19](https://github.com/banjonay1992/claim-check/issues/19)).** Run independent checks in parallel, scan source files once for both env and endpoints, and cache parse results between runs.
20. **Editor integration (about 10 hours, [#20](https://github.com/banjonay1992/claim-check/issues/20)).** A small language server that shows findings inline while editing Markdown, reusing the JSON output.
