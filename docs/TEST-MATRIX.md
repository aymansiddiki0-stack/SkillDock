# Test matrix

Designed to support multiple Workday tenant configurations through semantic
field detection, with graceful failure for unsupported layouts. This file
records what has actually been verified — no more.

## Automated coverage (executed)

| Date | Suite | Result |
|---|---|---|
| 2026-08-01 | Unit: normalization, exact matching (anti-fuzzy proofs), wait/cancellation/cleanup, locator scoring across 7 fixtures, dropdown resolution, chip reading | ✅ pass |
| 2026-08-01 | Integration: full engine against an interactive Workday-style harness (exact add, skip existing, unmatched, aria-linked and portal listboxes, delayed suggestions, delayed chips, unconfirmed selection, rerendered input, cancellation, progress, per-skill error recovery) | ✅ pass |
| 2026-08-01 | `tsc --noEmit` (strict), ESLint, esbuild production build | ✅ pass |
| 2026-08-26 | Unit: timing-preset resolution (slow matches prior defaults, max-safety timeouts identical across modes, settle/poll fields strictly shrink), `waitFor` pollMs granularity | ✅ pass |
| 2026-08-26 | Unit: portfolio storage migration (legacy skills → default portfolio, idempotent, never discards data, self-heals a corrupted active id), portfolio CRUD and skill-list isolation, speed-mode persistence | ✅ pass |
| 2026-08-26 | Unit: popup DOM behavior via jsdom (portfolio rendering/switching, inline new/rename/escape, delete guarded at one portfolio, save isolation, speed selector init/persist/propagation) | ✅ pass |
| 2026-08-26 | Integration: full engine reliability guarantees (exact matching, verification, stale-dropdown protection, rerender handling, cancellation) repeated under slow/medium/fast presets | ✅ pass |

## Static portal inspection (executed)

| Date | Host pattern | Observation |
|---|---|---|
| 2026-08-01 | `cdw.wd5.myworkdayjobs.com` | Server response is a bootstrap shell; UI fully client-rendered. Confirms dynamic-DOM design requirement. |
| 2026-08-01 | `workday.wd5.myworkdayjobs.com` | Same shell architecture; locale path segments (`/en-US/...`) vary. |

## Live in-browser smoke tests (pending)

Application forms sit behind account sign-in and per-posting flows, so live
smoke tests must be run interactively in Chrome by a maintainer. **Do not
submit applications while testing.** Record results here using this template:

| Date | Host pattern | Observed configuration | Skills field detected? | Exact selection verified? | Manual pick needed? | Limitation noted |
|---|---|---|---|---|---|---|
| _yyyy-mm-dd_ | `tenant.wdN.myworkdayjobs.com` | e.g. `searchBox` + `selectedItem` chips, portal listbox | yes/no | yes/no | yes/no | … |

Rules for entries:
- No login credentials, applicant data, private company information, or
  application answers in this file.
- A handful of tenants is not universal compatibility; keep claims scoped.
