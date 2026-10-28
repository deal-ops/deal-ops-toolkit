# Deal Ops Toolkit

A browser tool for SPV deal operations. It takes one deal through three steps:

1. **Payment reconciliation:** match bank receipts to investor commitments.
2. **Closing allocation:** work out what each investor invests, pays in fees and gets back, and what is wired to the company.
3. **Exit distribution:** split exit proceeds between investors and the lead, with carry, a hurdle and catch-up, or tiered carry.

Every figure is checked automatically, and the exit waterfall is explained step by step. Around these steps: chase and payment-query texts you copy and send yourself, an activity log of every decision, withdrawal before closing, and changing who pays a percentage fee before closing (recorded as a reversible adjustment). Deal data is processed and saved in your browser; the app sends none of it anywhere.

**Live:** https://deal-ops-toolkit.vercel.app (release `v1.2.1`)

## Try it

1. Open the live link and click **"I understand — take the 3-minute tour"**.
2. The tour loads a made-up seed round, "Northwind Robotics": 12 investors and 16 bank lines. Follow the card in the corner; press **Enter** or **Next** to move on, or **"Do this for me"** when a step asks you to act.
3. You will see £114,840.00 of receipts, £100,395.00 invested at closing and, for a £390,000 exit with £4,500 of costs after 6 years (20% carry, 8% hurdle, full catch-up), £57,021.00 of carry and £328,479.00 to investors.

"Load sample deal" brings the example back at any time; "Clear all data" empties the page.

## How the numbers stay right

- **Exact maths.** Money is whole pence, rates are basis points and share prices are millionths. Every money calculation, including the compounding hurdle, uses exact integer arithmetic.
- **Self-checks on every calculation**, shown next to each result (for example, cash received = invested + fees + refunds for every investor). A failed blocker stops copying, exporting and the hand-off to the next step.
- **An independent oracle.** A separate Python implementation (`scripts/oracle/`), written from the written rules only, agrees with the app field by field on the hand-calculated cases and on 1,800 generated cases. It also passes its own 178 checks.
- **Every planned test runs.** `npm run coverage:check` fails unless every test-plan case due at the current milestone ran and passed.
- **Mutation testing.** `npm run mutation` deliberately breaks the code in 267 places; each one must be caught by a test.

Counts at release v1.2.1 (2026-10-28): 420 unit tests, 199 of 199 due test-plan cases, 31 end-to-end tests covering 11 of 11 planned end-to-end cases, 267 of 267 mutants caught.

## How it was built

The project owner owns the problem, the requirements, the calculation rules, the trade-offs and the review gates, and accepted each milestone. Claude Code drafted the documents for the owner's sign-off and wrote the implementation. Correctness rests on the tests, the oracle, mutation testing and cross-reviews rather than on trusting the code.

- **Gates G0–G3:** requirements and design review (G0/G1), a review on every pull request (G2), and a release gate (G3) with the full manual checklist and the owner's explicit OK before production.
- **One pull request per milestone** (M1 engines, M2 reconciliation and allocation screens, M3 exit screen and guided tour, M4 release), each with automated checks and Codex cross-review until it returned READY or READY AFTER FIXES with the fixes applied, with a self-test gate from M1 round 2 on. After release, the owner's review of the live site led to one more pull request (interface polish, a theme switch and currency handling, released as v1.1.0), and a fix to the save-failure message followed as v1.1.1. Version 0.8 of the requirements added chase messages, an activity log, withdrawal and fee payer changes, built as M5 and M6 and released as v1.2.0. Counting the requirements and design reviews, the release-fix and post-release pull requests, Codex ran 42 rounds. See the [review summary](docs/en/REVIEW_SUMMARY.md).

## Scope and limits

- No money movement, no bank connections and no emails sent: it calculates and explains, and people act. Messages are copied for you to send.
- Withdrawal and fee payer changes only before closing.
- One currency per deal; one investment and one exit, with the same terms for every investor.
- No S/EIS eligibility decisions (schemes are labels you enter) and no legal or tax advice.
- The sample deal is made up.

## Privacy

Deal data stays in the browser (memory and local storage) and is never put in a URL. The site's content security policy blocks all outgoing connections from the page (`connect-src 'none'`), and an end-to-end test records every request to prove that only the site's own static files are loaded. There is no analytics.

## Documents

English snapshots of the project documents, taken at release v1.0.0 and updated at v1.1.0, v1.1.1, v1.2.0 and v1.2.1. The Chinese originals are the source of truth and are kept in the development repository; the Chinese test plan is included because the coverage scripts read it.

- [Requirements (PRD)](docs/en/01_PRD.md)
- [Technical design](docs/en/02_TECH_DESIGN.md)
- [Rules and review process](docs/en/03_RULES_AND_REVIEW.md)
- [Test plan](docs/en/04_TEST_PLAN.md) (the coverage scripts read the Chinese [`docs/04_TEST_PLAN.md`](docs/04_TEST_PLAN.md))
- [Guided tour design](docs/en/05_GUIDED_TOUR.md)
- [Progress record](docs/en/PROGRESS.md)
- [Review summary](docs/en/REVIEW_SUMMARY.md)
- [Release notes](docs/RELEASE_NOTES.md)

## Run it locally

Requires Node.js 22 and Python 3 (for the oracle).

```bash
npm install
npm run dev               # local app
npm test                  # unit tests, including the comparison with the Python oracle
npm run coverage:check    # every test-plan case due at the current milestone ran and passed
npx playwright install chromium   # once, before the end-to-end tests
npm run e2e:check         # end-to-end tests on a production build under the production security policy
npm run mutation          # mutation testing (about 10 minutes; edits source files temporarily)
```

## Fonts

Inter and IBM Plex Mono, both under the SIL Open Font License 1.1, are served by the site itself. Their licences are in `public/licenses/`.
