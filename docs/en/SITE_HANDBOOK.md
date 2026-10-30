# Project website handbook

English handbook for the project website, v1.3, 2026-10-30 (FAQ section; v1.2 and v1.1 earlier). Live at https://deal-ops-toolkit-site.vercel.app (source in `site/`). This is the basis for every later change to the site: when the design or a method changes, update this handbook and add a line to §9.

## 1. What the site is for

- **Readers:** people evaluating the project, and syndicate leads deciding whether the tool solves their reconciliation and allocation work.
- **After a minute they should know:** what it does (three steps); why the numbers can be trusted; where deal data goes (nowhere); how it was built; where to open it.
- **Claims:** it is called a prototype, and the page states only what is implemented, tested and released (PRD decision 4, rule P9). Every feature sentence and every figure must be traceable to `docs/RELEASE_NOTES.md` or to the sample deal in the test plan §3.
- **Identity:** the project's own visual design (PRD decision 8); no third-party names, marks, assets or page text. The footer keeps "Not affiliated with any platform".

## 2. Page structure (top to bottom)

| # | Section | Background | Content | Motion |
|---|---|---|---|---|
| 1 | Navigation | Floating glass capsules | Deal Ops Toolkit · How it works · Why trust it · How it was built · FAQ · Open the app | A pill slides to the hovered link; the glass turns dark over dark sections |
| 2 | Hero | Light, open, no container | Headline "Reconcile an SPV / to the penny.", the grey verb turning to Allocate and Distribute and back; lead paragraph; two buttons | Focus-in entrance; the verb turns letter by letter every 4.5 s, once round, then stops |
| 3 | Hero illustration | Full-width soft glow fading out above and below | Three panels: bank statement, closing allocation, exit waterfall (§4.2) | Panels rise in turn; bars grow; Review → Confirmed; the panel for the headline's verb lifts |
| 4 | Light to dark | Hard edge, no band (2026-10-30) | none ("How it works" for screen readers only); 96px of space at the top of the dark section (56px on phones) | — |
| 5 | Three-step deck | Dark full-width band | Three cards: text and a close-up clip from the real app; step labels with progress bars | Pinned; each card slides up over the last (§4.3) |
| 6 | Why trust the numbers | Same dark band | Small section label; four large figures, filled with a white-to-grey gradient: Exact · 1,800 · 267 / 267 · 199 / 199; the release the figures come from | Fade in |
| 7 | Dark to light | Hard edge (2026-10-30) | — | — |
| 8 | Privacy | Light, centred type | "Your deal data stays in your browser" and the app's privacy sentence (R-X-02) word for word | Fade in |
| 9 | How it was built | Light, four columns under hairlines | 01–04, the closing line on who does what, links to the repository and the review summary | Fade in |
| 10 | FAQ | Light, hairlines, group name left, questions right | 16 questions in 4 groups, native disclosure, closed by default (§4.5) | No entrance (§10 item 12) |
| 11 | Closing call to action | Full-width glow, echoing the hero | "Try it with the sample deal" / "No sign-up, nothing to install." / tour button | The glow drifts once (24 s) |
| 12 | Footer | Dark | Product / Code / Contact; the app's disclaimer (R-X-03); last, a near full-width wordmark fading downwards and cut off by the bottom edge (decorative, hidden from screen readers) | No entrance (§10 item 11) |

**Layout rules**
- At most one rounded container per screen (adopted after the first sample read as "cards stacked on cards").
- No bare large headings; section headings are small mono labels.
- Light and dark sections alternate and **meet at a hard edge**: a linear gradient between them passes through a muddy grey (bands removed 2026-10-30).
- A nav link lands with the section's content about 140px below the top; sections without their own top padding use `scroll-margin-top: 140px`. A link to one FAQ question lands it 140px down too (72px on phones, below the bar).

## 3. Design system

### 3.1 Colour
The app's own tokens (`src/index.css`), so the site and the app read as one product.

| Use | Light | Dark |
|---|---|---|
| Page `--bg` | `#f6f8f3` | `#161616` |
| Text `--text` | `#151619` | `#f9fafb` |
| Secondary `--muted` | `#5f6359` | `#a3a3a3` |
| Rotating verb `--soft` (large text only) | `#8a8f84` | `#8c8c8c` |
| Hairline `--line` | `#dde2d6` | `#2e2e2e` |
| Dark band `--band` | `#151619` | `#0b0b0c` |
| Cards on the band | `#1d1e22` | `#1c1c1c` |
| Primary button | ink `#151619`, text `#f6f8f3` | peach `#eab189`, text `#161616` |
| Glow | `#f3c7a3`, `#cfe0b8`, `#e7a57f` | `#6b4630`, `#3e4d33`, `#7a4a33` |
| Waterfall bars | investors `#151619`, lead `#e39a6c` | investors `#e9ede4`, lead `#e39a6c` |

Light or dark follows the device setting; there is no switch on the page.

### 3.2 Type
- Inter (variable) for text and headings, IBM Plex Mono for labels and numbers; both open-licensed, served by the site itself, Latin subset, preloaded.
- Hero headline `clamp(44px, 7.6vw, 100px)`, weight 500, line height 0.97, tracking −0.04em; below 380px `clamp(34px, 10.4vw, 44px)` so "Distribute an exit" fits one line at 320px.
- Section labels: mono 13px, upper case, tracking 0.14em. Card titles `clamp(28px, 3.1vw, 42px)` (pinned: `clamp(26px, min(3.1vw, 5.4vh), 42px)`). Trust figures `clamp(48px, 6.8vw, 98px)`, never wrapped, filled with a white-to-grey gradient (`#f6f8f3` 25% → `#8f938b` 110%, 5.8:1 at the darkest point); the box follows the figure (`width: max-content`), because a gradient clipped to the text paints only inside the box and the last digit of "199 / 199" was cut off; the size cap keeps ≥ 36px before the description at any width. Footer wordmark `calc((100vw - 2 * var(--gutter)) / 7.2)`: it spans the gutters (the word is about 7 times as wide as its size, with slack for a scrollbar), fades from 30% white to transparent and loses about 0.14em to `overflow: hidden` at the bottom; plain 14% white where `background-clip: text` is unsupported. Amounts always `tabular-nums`.

### 3.3 Shape and shadow
- Buttons and nav are pills; buttons 48px high. Hero panels radius 18px with four shadow layers; deck cards radius 24px; clip frames 12px.
- Hero panels are proportional: sides 34 % each, centre 34 % at 33 %, so the centre overlaps each side by 1 % of the width (about 11px), inside its padding. At 1080px and below the panels stack, up to 440px wide.

### 3.4 Motion
| Rule | Detail |
|---|---|
| Two curves | entrances `cubic-bezier(0.22, 1, 0.36, 1)`, hovers `cubic-bezier(0.4, 0, 0.2, 1)` |
| Durations | large entrances 0.9–1.1 s; hovers 0.18–0.24 s; bars 0.9 s |
| Once | entrances, the headline and the clips play once; nothing loops |
| Auto-motion ≤ 5 s | the page has no pause control, so every clip that plays by itself is under 5 s (WCAG 2.2.2) |
| Cheap properties | only transform, opacity and filter; the panel lift uses the separate `translate` property so it never fights the entrance `transform` |
| Reduced motion | everything still; clips give way to their last frame; the deck is a list |

## 4. Components

### 4.1 Navigation
Fixed capsules. The hover pill's position is computed by `site.js` and passed as CSS custom properties (no inline styles). The glass turns dark while a dark section sits under it; the watched band is the nav's own strip in pixels, because Intersection Observer resolves percentage margins against the width. At 760px and below (phones) the nav becomes one bar across the top, nearly opaque, blurred, with a hairline below: the brand on the left, "Open the app" on the right, the four section links hidden. Nav labels never wrap; with four links the capsules tighten from 761 to 900px (links 10px, brand and button 14px) so they fit at 761px (scanned pixel by pixel from 761 to 1200px). The floating capsules covered the text scrolling under them on a phone.

### 4.2 Hero illustration
- Three product panels drawn in type, not screenshots: crisp at any size and readable at a glance.
- **Every figure is the sample deal's** (test plan §3):
  - Bank statement: A HART £10,000.00 Matched; B OKAFOR £5,000.00 Matched; CHLOE MARTIN £20,000.00, no reference, suggested Chloe Martin with score 0.55, **confirmed by a person** (Review → Confirmed); D KIM £2,000.00 Matched.
  - Closing allocation: Amelia Hart £9,700.00, Ben Okafor £4,850.00, Chloe Martin £19,400.00, David Kim £1,940.00, "and 7 more investors · £100,395.00 invested"; Wire to company £98,895.00.
  - Exit waterfall: £390,000 exit, 20 % carry, 8 % hurdle; "£4,500 exit costs first · 6 years · full catch-up · £385,500 to share"; Return of capital £100,395.00, Preferred return £58,919.25, Lead catch-up £14,729.81, Carry split 80 / 20 £211,455.94; Carry to the lead £57,021.00. The four steps add up to £385,500 = £390,000 − £4,500.
- Bars are to scale against the largest step (£211,455.94 = 100 %): 47.5 %, 27.9 %, 7 %; the split bar is 80 % investors, 20 % lead.
- Default styles are the final state; the entrance animations only lead up to it, so reduced motion shows the finished picture.
- Screen readers: the figcaption states the three steps in one sentence; the animated "Review / Confirmed" labels are hidden and one stable "Confirmed" is given instead.

### 4.3 Three-step deck
- Pinned only when the window is at least 900px wide and 620px tall and motion is allowed (CSS and `site.js` use the same query); otherwise a plain list.
- As the scroll progress p goes from i − 1 to i, card i rises from below the stage and covers the one before; each covered card steps back 14px and 4 % per card above it and lightens a little, so its top edge peeks out. Later cards paint on top, so there is no z-index swap (an early version swapped mid-way and the whole picture cut).
- The card area clips at its bottom edge, so a rising card appears from there; the step labels sit below it and are never covered.
- A card's clip starts once the card is 75 % up, plays once from the start and rests on its last frame; a hidden tab pauses it and it resumes where it was.
- Close-ups are feathered once, on the frame (right edge; the exit close-up on both sides). Feathering the still and the clip separately let the still show through as a ghost.

### 4.4 Other sections
Type only, no cards: large figures under hairlines; centred privacy statement; four columns under hairlines; a full-width glow for the call to action. Content fades in once (blur 12px and 28px down to sharp in 0.9 s).

### 4.5 FAQ
- **Why:** so a visitor can tell quickly whether the tool fits their deal. No articles for now.
- **Content:** 16 questions in four groups (Is it for me? / Your data / Common situations / Trust and status). Each answer is traced to a requirement or a release-notes entry. No test counts here (they live in the trust section only): the only numbers allowed are 3 (the tour), 10 (days), 2.0 (Apache-2.0) and 103 (MT103). "Where does my deal data go?" (`#faq-data`) carries the app's privacy sentence word for word. Every quoted phrase must be, whole, on-screen text in the app (its `.tsx` files, not comments or tests) or a CSV header alias in `src/lib/csv.ts`. `site:check` checks all three; each check was shown to fail on a deliberately broken copy.
- **Structure:** one native `<details class="faq__item" id="faq-…">` per question, its `<summary>` the question and one `<p>` the answer. It opens without the script and with Enter or Space. Wide screens put the group name on the left; 900px and below, one column. The marker turns from `+` to `−`.
- **Links to one question:** an address such as `#faq-import` makes `site.js` open that question, on arrival and on later in-page links; it reads the address only and stores nothing; a malformed address matches nothing and throws no error.
- **No** FAQPage structured data: it needs an inline script (against the CSP), and since August 2023 Google shows FAQ rich results only for well-known government and health sites.

## 5. Media: close-up clips

- **Only the real app**, on the sample deal Northwind Robotics. `scripts/site-media.mjs` clicks the real buttons, as the end-to-end tests do.
- **Captured at 2×:** the window is 2880 × 1720 and the app is zoomed × 2 with CSS zoom (the same layout as 1440 × 860); frames come from Chrome's screencast and are joined with ffmpeg. Playwright's video and Chrome's screencast both capture CSS pixels, so a device-pixel ratio alone does not give 2×.
- **Framing:** a 640 × 400 region around one action: reconciliation from Summary, allocation from Result, exit from "Carry to the lead" (the totals that change).
- **Length:** each under 5 s (4.2–5.0 s now); no fades; each ends on its real last frame.
- **Format:** MP4 (H.264) only, 0.1–0.2 MB each (VP9 came out about 5 × larger). The still is the last frame: the picture before loading and under reduced motion. Light and dark sets, chosen by `<source media>`.
- **Re-record:** `npm run build && npx vite preview --port 4175`, then `node scripts/site-media.mjs` (needs ffmpeg). Re-record whenever the app's screens change.

## 6. Technology and files

| File | Role |
|---|---|
| `site/index.html` | The page (no inline styles or scripts) |
| `site/styles.css` | All styles |
| `site-src/site.js` | Readable source of the motion script |
| `site/site.js` | Built by `npm run site:build` (rolldown, installed with vite); lint skips it |
| `site/vercel.json` | Security headers: `script-src 'self'`, `media-src 'self'`, otherwise as the app |
| `site/media/`, `site/fonts/`, `site/img/grain.svg` | Clips and stills, fonts, grain texture |
| `scripts/check-site.mjs` (`npm run site:check`, also in CI) | One external script and no inline script, style attribute or handler; local files and anchors exist; external links only to the app and the public repository; the privacy and disclaimer sentences match the app word for word; the trust figures are backed by the release notes; `site/site.js` is the current build and ≤ 6 KB gzip; every clip ≤ 5 s; the CSP is complete |
| `scripts/site-preview.mjs` | Serves `site/` with the headers from `vercel.json`: `node scripts/site-preview.mjs 4180` |
| `scripts/site-shots.mjs` | Screenshots at desktop light and dark, 1261 × 657, 375px and reduced motion, with console and CSP errors |

- The script only adds classes, sets custom properties through the CSSOM and plays the clips; the page is complete without it. Limit: ≤ 6 KB as served (gzip); about 2 KB now.
- Page weight: about 1 MB for one theme (clips, stills, fonts).
- **No sideways scroll on phones:** `overflow-x: clip` on both `html` and `body`. The glows are 100vw wide; on `body` alone the setting passes to the viewport and phone browsers widen the layout to 1.5 ×.

## 7. Accessibility
- Focus rings: ink on light surfaces, light on the dark band, cards and footer (≥ 3:1).
- Skip link; every section has a heading (labels are h2).
- Auto-motion ≤ 5 s and once; reduced motion is fully still.
- Animated text states are hidden from screen readers, with one stable text instead.
- The FAQ uses native `<details>/<summary>` with their roles untouched, so screen readers announce the open state.

## 8. Change checklist
1. **Copy and figures (P9):** check against `docs/RELEASE_NOTES.md` and the test plan §3; after a release, update the trust figures and the "Figures from …" line. Check each FAQ answer against its source; when the app's features or wording change, update the FAQ.
2. **App screens changed:** re-record the close-ups (§5); check the framing and ≤ 5 s.
3. **Automatic checks:** `npm run site:check`.
4. **Screenshots:** `scripts/site-shots.mjs` with no errors; on a phone profile at 320, 375, 390 and 768px the page width equals the window; from 1081 to 1920px the hero panels stay clear of each other.
5. **Anchors:** each of the four nav links lands about 140px below the top; an address such as `#faq-import` opens that question below the nav.
6. **Lint and format:** `npm run lint`; prettier only on changed files, `--single-quote --no-semi --print-width 160`.
7. **Script:** `npm run site:build`, ≤ 6 KB gzip.
8. **Review:** self-test, then cross-review. Judge every finding first — is it true, is it worth it, is there a better fix — and record accept, reject or a different fix, with the reason.
9. **Update this handbook** and add a line to §9.

## 9. Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-29 | A separate static site in `site/`, its own hosting project, English only | Keeps the app and its gates untouched |
| 2026-10-29 | One small hand-written script, no framework | Pure CSS can only tie motion to the scroll bar; "play once on entering the view" needs a few lines of script |
| 2026-10-29 | Open hero and a dark full-width band; at most one rounded container per screen | The first sample read as cards stacked on cards; of three layout options the owner chose this one |
| 2026-10-29 | The hero illustration is drawn in type, not a screenshot | A shrunken screenshot was dense and unreadable; the owner asked for a designed image |
| 2026-10-29 | No page-wide pause control; every auto-motion ≤ 5 s instead | The owner found the control superfluous. Remaining: the headline changes three times over 13.5 s, then stops |
| 2026-10-29 | No bare large headings; small labels; 120px bands | The owner's direction; a review also found the 180px band heavy |
| 2026-10-29 | All three nav links kept, and their sections built | Removing links to sections not yet built was the wrong fix |
| 2026-10-29 | The script limit counts the size as served (gzip) | Owner's choice |
| 2026-10-29 | Proportional hero panels rather than a higher stacking breakpoint | A review suggested stacking up to 1216px; that would turn small laptops into one narrow column |
| 2026-10-30 | FAQ section: 16 questions in four groups after "How it was built", a fourth nav link; native disclosure; a link to one question opens it; no articles, no structured data | Owner's decision, every answer approved. A new section describing money rules, so it also had one cross-review round on factual accuracy |
| 2026-10-30 | Trust figures filled with a white-to-grey gradient; footer wordmark moved to the bottom, near full width, fading and cut off; light and dark sections meet at a hard edge (120px bands removed, 96px top space on the dark section); no grain on the dark sections | Owner's decision. A gradient between dark and light passes through a muddy grey; grain on the dark sections was barely visible and risked dropped frames while the deck is pinned |

## 10. Lessons
1. Judge review findings before changing anything.
2. Swapping z-index mid-transition cuts the picture; let later cards paint on top.
3. Dimming dark cards with the light page colour makes them look like grey plastic; on a dark band, lighten covered cards slightly.
4. Playwright and Chrome capture 1 × pixels; for 2 ×, double the window and zoom the app.
5. Feathering two stacked layers separately makes a ghost; feather the frame once.
6. 100vw decorations can widen a phone layout; clip on `html` too, and measure `scrollWidth`, not just one screenshot.
7. Intersection Observer's percentage margins resolve against the width; use pixels.
8. Mid widths escape screenshots: 1081–1200px once had overlapping panels, and with a fourth nav link the nav wrapped at 761–785px while the 800px screenshot looked fine. Scan nav changes pixel by pixel from 761 to 1200px.
9. Desktop spacing does not carry over to phones: gaps became empty screens; phones use about half. Floating capsules cover content on a phone; use a bar.
10. An illustration must add up and must not mislead: the missing £4,500 of exit costs, and a confirmation that looked automatic, both weakened it.
11. Nothing at the very bottom of the page may use the scroll-in entrance: its trigger line sits "12%" above the bottom of the window, and that percentage resolves against the window **width** (item 7), about 170px on a desktop; the footer wordmark never reaches it, so it would stay invisible. Show such elements as they are.
12. Content reached by a link must not use the entrance: it starts 28px low, the browser scrolls to that position, then the content rises 28px and on a phone slips under the nav bar (an FAQ question link, 2026-10-30). The FAQ has no entrance.

## 11. Deployment
- Hosting project `deal-ops-toolkit-site`: root directory `site`, no build, production branch `release` (as the app: production only from `release`).
- Release: merge the pull request into `main` → `npm run site:check` and confirm the app build is unchanged → merge `main` into `release` → both projects deploy from `release` → check the live headers and files.
- Roll back by pointing production at the previous deployment, or by resetting `release` and pushing again.

## 12. Not done yet
- Nothing. The owner checked the site on an iPhone; the two problems he found (the nav covering text, oversized phone gaps) are fixed.
