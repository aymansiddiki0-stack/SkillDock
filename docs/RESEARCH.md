# Research notes

Practical findings that shaped the implementation. Kept short on purpose.

## Chrome extension platform (Manifest V3)

- **MV3 + programmatic injection.** `chrome.scripting.executeScript({ files })`
  from the popup, combined with the `activeTab` permission, injects the
  content script into the tab the user invoked the extension on — no
  `host_permissions` and no `content_scripts` manifest entry required. This is
  the minimum-permission path recommended by Chrome's docs and satisfies the
  Web Store's single-purpose and least-privilege reviews.
- **`activeTab` scope.** The grant applies to the top frame of the active tab
  after a user gesture (opening the popup / clicking the action). It does not
  cover cross-origin iframes. See "Frames" below for why that is acceptable.
- **Popup lifecycle.** The popup document is destroyed the moment it closes,
  so the fill run cannot live there. MV3 service workers are also suspended
  aggressively and have no DOM access. The run therefore lives in the
  **content script**, which persists for the lifetime of the page. The popup
  is a thin client: it starts/cancels runs and polls status.
  Consequence: no background service worker is needed at all, which removes an
  entire moving part. The final report is additionally written to
  `chrome.storage.local` (content scripts may use extension storage) so a
  popup opened after completion can still display results.
- **Remote code.** MV3 forbids remotely hosted executable code. The build
  emits self-contained IIFE bundles; there is no `eval`, no CDN, no fetch of
  scripts, and no network access anywhere in the extension.
- **Repeat injection.** `executeScript` may run the content bundle again on
  every popup interaction; a `window.__skilldockLoaded` guard makes repeats a
  no-op so listeners are never duplicated.

## Workday portals

- **Client-rendered SPA.** Fetching `*.myworkdayjobs.com` portals
  (e.g. `cdw.wd5.myworkdayjobs.com/Careers`,
  `workday.wd5.myworkdayjobs.com/...`) returns only a bootstrap HTML shell
  with meta tags; the entire UI, including application forms, is rendered
  client-side by React. Any static selector assumption is therefore fragile
  by construction, and the extension must synchronize on live DOM state.
- **Hosting domains.** Tenants live under `{tenant}.wd{n}.myworkdayjobs.com`
  and `{tenant}.wd{n}.myworkdaysite.com` with varying `wd1/wd3/wd5/wd12`
  shards and locale path segments. Hard-coding hostnames was rejected;
  `activeTab` sidesteps the problem entirely (the user decides which tab).
- **Design system.** Workday's public Canvas design system documents its
  Select/MultiSelect components as ARIA 1.2 comboboxes: `role="combobox"`,
  `aria-autocomplete`, `aria-expanded`, `aria-controls` to a
  `role="listbox"` of `role="option"` items. This makes accessibility
  attributes the most durable detection signal across tenants.
- **`data-automation-id`.** Community automation projects and archived DOM
  snapshots consistently show stable automation hooks on application forms:
  `formField-*` wrappers, `multiselectInputContainer`, `searchBox` on the
  autocomplete input, `selectedItem` on chips, and `promptOption` /
  `activeListContainer` on the suggestion popup. These are *test hooks*, not
  generated class names, and have been stable for years — but they are still
  tenant-version dependent, so they are used as **secondary scoring signals**,
  never as the sole locator.
- **Portal-mounted popup.** The suggestion list is frequently rendered in a
  portal directly under `<body>`, not inside the field container. Dropdown
  detection therefore resolves ARIA links first and falls back to "the single
  visible listbox anywhere in the document".
- **Rerenders.** React reconciliation can replace the input node (e.g. after a
  chip is added). The engine checks `isConnected` before every skill and
  re-runs the locator when the node was swapped.
- **Existing chips.** Selected skills appear as chips with a remove button;
  in some variants the chip's only textual value is the button's
  `aria-label` ("Remove Python"). Both shapes are read.
- **Empty state.** An unmatched query typically produces an explicit
  "No matches found" panel. Detecting it lets unmatched skills fail fast
  instead of waiting out a timeout.

## Frames and shadow DOM

- Workday application forms on `myworkdayjobs.com` render in the top frame;
  embedded career sites usually *link out* to the Workday-hosted flow rather
  than iframe it. First release therefore supports the top frame only and
  reports a clear failure otherwise — no broad host permissions were added
  for a hypothetical iframe case.
- Open shadow roots are traversed by the locator and dropdown finder (one
  simple recursive walk). Closed shadow roots are not bypassed.

## Decisions made from these observations

1. Content script owns the run; no background worker; popup is stateless.
2. Semantic scored locator (accessible name, headings, ARIA combobox
   semantics, automation-id hints, chip presence) with an acceptance
   threshold *and* a lead margin over the runner-up; ambiguity → manual pick.
3. Native-setter + `input` event for controlled inputs, with a
   character-by-character fallback when the framework rejects the value.
4. `MutationObserver`-driven waits with a polling safety net, hard timeouts,
   and AbortSignal cancellation.
5. Verification = chip state diff, never the click itself.

## Assumptions still requiring real-world validation

- The `data-automation-id` hooks (`searchBox`, `selectedItem`,
  `multiselectInputContainer`) remain present on current tenant versions.
  (Detection degrades to ARIA/label signals if they disappear.)
- The "No matches found" empty state's wording across locales — non-English
  tenants will fall back to the options timeout instead of failing fast.
- Suggestion latency bounds (8 s options / 4 s verify) suit slow tenants.
- Chip rendering always lands inside the field container the locator scopes.

## Known limitations

- English-language detection heuristics ("Skills", "Remove …",
  "No matches"). Non-English tenants likely need the manual field picker and
  will time out rather than fast-fail on unmatched skills.
- Top-frame pages only; closed shadow roots not supported.
- Live-portal smoke testing must be re-run periodically; see
  `docs/TEST-MATRIX.md`.
