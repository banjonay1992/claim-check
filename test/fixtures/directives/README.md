# Sample Directives

<!-- claim-check-ignore -->
This paragraph mentions `src/ignored-one.ts`, which does not exist.

This line is ignored too: `src/ignored-two.ts` <!-- claim-check-ignore-line -->

<!-- claim-check-ignore-start paths -->
- `src/ignored-three.ts`
- `src/ignored-four.ts`
<!-- claim-check-ignore-end -->

<!-- claim-check-ignore scripts -->
This paragraph only ignores scripts, so `src/reported.ts` is still reported.

Not ignored at all: [missing](./missing.md).
