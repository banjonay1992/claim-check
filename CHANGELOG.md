# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-31

First release.

### Added

- `claim-check [dir]` command with `--config`, `--only`, `--skip`, `--run`, `--external`, `--format`, `--json`, `--output`, `--fail-on`, `--quiet`, `--no-color` and `--list-checks`.
- A shared document model built on mdast, with GitHub-compatible heading slugs and ignore directives.
- `paths` check for link targets, images, HTML links and inline code paths, with exact-case checking.
- `links` check for heading anchors within and across Markdown files, and optional external URL checking with timeouts, a concurrency limit and a cache.
- `scripts` check for npm, pnpm, yarn and bun scripts and make targets.
- `env` check comparing variables read in code (in thirteen languages) and listed in example env files with the variables the docs mention.
- `endpoints` check matching documented HTTP routes against route definitions in common frameworks.
- `commands` check that lists runnable shell blocks and, with `--run`, executes them in a temporary copy of the project with a timeout.
- Human, JSON, JUnit and SARIF reporters.
- `claimcheck.config.json` with validation and clear errors.
- Fixture projects and tests for every check, CI on GitHub Actions, and a self-check of this repository's docs.
