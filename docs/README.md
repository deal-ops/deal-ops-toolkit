# Docs

English snapshots at release v1.0.0 (the Chinese documents are the source of truth):

- [`en/01_PRD.md`](en/01_PRD.md): requirements, numbered rules (R-*, C-*, I-*) and decisions
- [`en/02_TECH_DESIGN.md`](en/02_TECH_DESIGN.md): technical design, security and privacy
- [`en/03_RULES_AND_REVIEW.md`](en/03_RULES_AND_REVIEW.md): working rules, review gates G0–G4, definition of done
- [`en/04_TEST_PLAN.md`](en/04_TEST_PLAN.md): test cases (TC-*), the sample deal with hand-worked numbers, end-to-end cases (E2E-*), the manual checklist (M-*)
- [`en/05_GUIDED_TOUR.md`](en/05_GUIDED_TOUR.md): guided tour design
- [`en/PROGRESS.md`](en/PROGRESS.md): what each stage delivered, how it was checked and reviewed
- [`en/REVIEW_SUMMARY.md`](en/REVIEW_SUMMARY.md): every review round, its verdict and what changed

Other files:

- [`RELEASE_NOTES.md`](RELEASE_NOTES.md): what is in each release (only what is implemented, tested and deployed)
- [`04_TEST_PLAN.md`](04_TEST_PLAN.md): the Chinese test plan, which `npm run coverage:check` and `npm run e2e:check` read to know which cases are due
- `milestone.txt`: the current milestone, read by the same scripts
- [`perf.md`](perf.md): benchmark results at the v1 limits (`BENCH=1 npx vitest run src/lib/perf.test.ts`)
- `scripts/check-en-docs.mjs` (development repository only, because it needs the Chinese sources): checks that each English snapshot keeps every ID and number of its source, row by row for every table row and rule that starts with an ID (differences made on purpose for the public version are listed in the script; `--self-test` replays known translation errors and fails if any is missed)
