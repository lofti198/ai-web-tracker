# AI Web Tracker — handoff summary

Written for a fresh coding agent (e.g. Codex) picking up this project without
the conversation history that produced it. This describes **what exists, why
it's built this way, and what's still open** — not "how to work in this repo"
(that's [AGENTS.md](../AGENTS.md), read it too, it's the canonical
day-to-day reference and stays up to date as the code changes).

## What this is

A Chrome extension (Manifest V3, no build step — `Load unpacked` and go).
On a manual "Scan now" click, it crawls one or more configured web sources
through **real browser tabs** (not background `fetch()`), extracts entities
from a listing page and optionally a detail page per entity, runs them
through local + AI filters, dedupes, and stores results in IndexedDB. A side
panel-style UI (opened as a normal Chrome tab) shows live progress, results,
history, logs, source config, and account settings (API key + resume).

Originally scoped as a workshop teaching template ("copy a parser file,
adapt it to your site"), it evolved mid-build into something closer to a
personal tool too — several decisions below trace that shift.

## Folder structure

```
ai-web-tracker/
├── manifest.json              MV3 manifest — read this first for permissions/version
├── README.md                  User-facing install + usage docs
├── AGENTS.md                  Canonical agent instructions + "what to change where" map
├── CLAUDE.md                  Thin pointer into AGENTS.md (Claude Code auto-loads this)
├── docs/
│   ├── ux-overview.md         UI/UX audit written for an external reviewer
│   └── HANDOFF.md             This file
├── background/
│   └── service-worker.js      Orchestrates scans, messaging, panel-tab lifecycle
├── parsers/
│   ├── parser-interface.js    JSDoc-only contract (not executed) for source authors
│   ├── tab-crawler.js         The crawl engine — opens tabs, waits for DOM, injects extraction
│   ├── ensure-permission.js   chrome.permissions request/check helpers
│   ├── searches.js            Storage + validation for saved searches; maps them to supported parsers
│   ├── index.js               Registry of hardcoded supported sources/parsers (unused by the
│   │                           live UI path — see "Two ways to add a source" below)
│   ├── example-single-phase.js  Demo: Hacker News Jobs (list page has everything)
│   ├── example-two-phase.js     Demo: RemoteOK (list page + per-entity detail page)
│   ├── weworkremotely.js        We Work Remotely (list + detail)
│   ├── euremotejobs.js          EU Remote Jobs (list + detail)
│   └── aijobs.js                aijobs.com (list + detail)
├── filters/
│   ├── keyword-filter.js      Match title against a word list
│   ├── minus-word-filter.js   Reject title matching a word list
│   ├── ai-filter.js           OpenAI Chat Completions batch classification
│   └── pipeline.js            Chains the three filters in cost order
├── storage/
│   ├── db.js                  IndexedDB wrapper (items store) + URL normalization
│   └── logs.js                Rolling technical-log store (chrome.storage.local, capped array)
├── panel/                     The UI — 6 tabs, one JS file per tab, no framework
│   ├── panel.html / panel.css
│   ├── tabs.js                 Generic tab-switcher (data-tab-target/data-tab-panel)
│   ├── item-card.js             Shared result-card renderer (used by Main + History)
│   ├── tab-main.js              Scan now/Stop, live progress, "Just found"
│   ├── tab-searches.js          Saved searches list + "Add search" popup logic
│   ├── tab-filters.js           Keyword/minus-word/AI filter config
│   ├── tab-profile.js           OpenAI API key + resume (files + text)
│   ├── tab-history.js           All-time results
│   └── tab-logs.js              Technical run log viewer
└── icons/                      16/48/128 PNGs (placeholder, PIL-generated)
```

## Architecture, and why it looks like this

### Real browser tabs, not `fetch()`
Early version fetched a JSON API (RemoteOK) and static HTML (HN) directly
from the service worker. Explicitly changed to a generic two-phase crawl
through real tabs (`tab-crawler.js`): open `listUrl` in a background tab →
inject `extractLinks` → for each new entity, open its own tab → inject
`extractDetail`. This generalizes to any site (including JS-rendered ones)
at the cost of visible tab flicker during a scan, which is accepted as
expected behavior, not a bug.

### Panel is a plain Chrome tab, not a popup or `chrome.sidePanel`
Chosen to match a reference pattern the user pointed at (a sibling project,
`ap2p-monitor`): `chrome.action.onClicked` → `chrome.tabs.create`, with
reuse/focus of an already-open panel tab (URL-verified before reuse, to
guard against Chrome recycling tab IDs — see Bugs Fixed below).

### Scanning is manual-only — no scheduler
There **was** a `chrome.alarms`-based scheduler with Start/Pause/Stop
semantics. It was **removed entirely** by explicit request — the current
model is a single "Scan now" button (one-shot) plus "Stop" (cancels an
in-flight scan only). Do not reintroduce polling/scheduling unless asked —
see the "Сканирование только ручное" section in AGENTS.md for the reasoning
and the gotcha it left behind (next section).

### Two registries for one source-adding mechanism — keep them in sync
An earlier design considered two genuinely different mechanisms: file-based
parsers (real JS functions via `chrome.scripting.executeScript`) vs. a
UI popup where users would paste `extractLinks`/`extractDetail` as text,
executed via `chrome.userScripts.execute()` (the only sanctioned way to run
dynamically-supplied code under MV3's `'unsafe-eval'` ban — confirmed the
hard way, see Bugs Fixed below). That popup-based code-paste path was **never
shipped this way** in the current code; the open question the earlier version
of this doc flagged ("should the popup be simplified to just Name + List
URLs?") has been resolved in favor of the simpler option.

Current reality — **one mechanism, two registries that must both be updated**:

1. Write a parser file under `parsers/<name>.js` implementing the contract in
   `parsers/parser-interface.js` (`originPattern`, `listUrls`,
   `extractLinks`, optional `extractDetail`) — real JS function references,
   run via `chrome.scripting.executeScript`.
2. Register it in `parsers/index.js` (`SOURCES`). **This alone is not
   enough** — `getAllSources()`/`isSupportedSource()` from this file are not
   imported anywhere else in the codebase (verified by grep); this registry
   is currently dead weight for the live UI path.
3. Also register it in `parsers/searches.js` (`SUPPORTED_SOURCES`), with a
   `label` and an `origin`. This is the registry `parseSupportedUrls()`
   actually checks (`URL.origin === source.origin`) when a user saves a
   search from the "+ Add search" popup — skip this and the domain is
   rejected with "Unsupported site" no matter what's in `index.js`.

The "+ Add search" popup itself only ever asks for `Name` + `List URLs` (one
per line) — no code-paste fields, no `chrome.userScripts`, no "Allow User
Scripts" toggle required. Older drafts of `docs/ux-overview.md` described a
code-paste popup that was never shipped — that file has since been
corrected to match `panel/panel.html`'s actual `#add-search-dialog`
markup; if this description and the current UI ever disagree again, trust
`panel.html`, not prose.

### Per-source incremental pipeline, not one big batch
`runScan()` in `service-worker.js` used to: crawl all sources → combine →
filter once → save once → report once. Now each source is filtered and
saved **as soon as its own crawl finishes** (sources still run in parallel
via `Promise.allSettled`) — so a fast source's results appear while a slow
source is still working, instead of everything appearing at once at the
end. AI-filter batching cost is unaffected: it was already capped by
`maxEntities` per source, so per-source batching is the same number of API
calls as the old global-batch approach.

### "Just found" vs "History" — one shared card renderer
Main tab shows only the current/latest run's results (`ui.lastRunItemIds`
in `chrome.storage.local`, refreshed live per source and again on
`scan-end`); History shows everything ever found. Both render through
`panel/item-card.js` so they can't visually drift apart. Cards show a
truncated description, `details` bag as tag chips, and a badge for *which*
filter matched (`matchedKeywords` → "Keyword filter: …", `aiVerdict` →
"AI filter: …") — added because the user wanted visibility into why an
item passed, not just that it did. The Logs tab also gets a per-source
`filter-result` line summarizing pass/reject counts and up to 5 rejected
titles, for the same reason.

The "Just found" section (heading + list) is hidden entirely (not shown
with a "nothing found yet" placeholder) whenever the current/last run has
zero items — see `hideJustFound`/`clearJustFound`/`refreshJustFound` in
`panel/tab-main.js`. A previous version always showed the section with an
empty-state message; changed on explicit request so the label only appears
once there is at least one result to show.

### Optional history — "Use history" toggle on the History tab
`chrome.storage.local['history.enabled']` (default `true`) is read once per
scan in `background/service-worker.js` (`runScan`) and threaded through as
`useHistory` into `parsers/tab-crawler.js`'s `crawlSource()`. When `false`:
- `hasId()` (IndexedDB lookup) is skipped entirely — every link is treated
  as new, so cross-scan duplicate suppression is off.
- `saveIfNew()` (IndexedDB write) is skipped entirely — nothing persists to
  `storage/db.js`'s `items` store; results still appear in "Just found" for
  the current run (held in memory / `ui.lastRunItemIds`), but vanish once a
  new scan starts or the panel state resets.
Verified by grepping the whole repo: `saveIfNew` and `hasId` each have
exactly one call site, and both are gated by `useHistory`.

### DOM-ready wait strategy
`tab-crawler.js` waits for `chrome.webNavigation.onDOMContentLoaded` (main
frame only) with a **soft** 10s timeout that never throws — it just
proceeds to extraction with whatever rendered. This replaced waiting for
the full `load`/`status === 'complete'` event, which was too slow on sites
with heavy ads/trackers (RemoteOK specifically caused repeated false
timeouts) and doesn't matter — DOM structure is what extraction needs, not
every last resource.

### Profile tab (labeled "Setting" in the UI): API key + résumé, feeding the AI filter
Consolidated onto one tab (a deliberate choice to avoid adding two more
tabs to an already-busy bar — flagged to the user, not re-litigated):
OpenAI API key (moved off the Filters tab, since it's an account-level
setting, not a per-filter one) and résumé/CV. Résumé supports attaching
**multiple** files (any type, stored as data URLs, individually removable)
plus a free-text field. Only `.txt` attachments get their text auto-read
into that field (appended, not overwritten, so multiple `.txt` files don't
clobber each other); PDF/DOCX are stored for reference only — **no text
extraction for those formats**, on purpose (would need a bundled parser
library like pdf.js; can't load it via CDN `<script>` under MV3's
remote-code-execution ban, and vendoring one locally was judged
disproportionate to the ask). The free-text field is what actually reaches
the AI filter's prompt, alongside the user's typed criterion.

**Currently disabled in the UI**: the whole Résumé/CV block in
`panel/panel.html` is wrapped in an HTML comment, so it doesn't render on
the Setting tab. `panel/tab-profile.js` still reads/writes
`profile.cvText`/`profile.cvFiles` and null-safely no-ops on the missing
elements (`?.` throughout) — nothing is broken, there's just currently no
UI to populate `profile.cvText`. `filters/ai-filter.js` still reads and
uses it if a value already exists in storage from before the block was
hidden. Uncomment the block in `panel.html` to bring it back; no other code
changes needed.

### Generic schema, not job-specific
Despite both demo sources being job boards, the item schema (`url, title,
meta, description, postedAt, details, source, foundAt, matchedKeywords,
aiVerdict`) and the engine avoid job-specific naming (`vacancy_*` etc.).
`details` is a free-form key-value bag each parser populates however makes
sense for its domain (job sites use `company`/`location`/`tags`).

## Bugs fixed this session (don't reintroduce)

- **MV3 blocks `'unsafe-eval'` for extension pages, full stop.** An early
  attempt to relax `content_security_policy.extension_pages` to allow
  `new Function()`-based code compilation made the manifest fail to load
  entirely ("Insecure CSP value... Could not load manifest"), even for
  `Load unpacked`. Not configurable. `chrome.userScripts` is the real fix
  (see above).
- **`<dialog>` CSS cascade trap.** Setting `display: flex` unconditionally
  on the dialog's class made it permanently visible (author-origin CSS
  beats the UA stylesheet's `dialog:not([open]) { display: none }`
  regardless of selector specificity). Fixed by scoping to
  `.add-search-dialog[open]`. Any future dialog-like element needs this
  same care.
- **`chrome.alarms` doesn't survive an unpacked-extension reload; `chrome.storage.local` does.**
  This caused a stale "isRunning" flag to desync from reality after every
  dev reload. General lesson applied throughout: derive "is X currently
  happening" from the actual live source of truth (e.g. a module-level
  in-memory flag, or an actual `chrome.alarms.get()`/similar check) —
  never a separately-maintained boolean that can drift.
- **Reused/stale tab IDs.** The panel-tab-reuse logic now verifies the
  candidate tab's URL actually matches the panel before reusing it, since
  Chrome can recycle a tab ID for something unrelated after the original
  tab closes.
- **Full-page-load waits were too slow** on ad-heavy sites — see DOM-ready
  strategy above.

## Explicitly out of scope (don't build unless asked)

- PDF/DOCX text extraction.
- Scheduled/automatic scanning (was built, then explicitly removed).
- Pagination/infinite-scroll handling beyond what a single page load shows
  (though `listUrls` already supports multiple manually-specified pages
  per source).
- True per-item live streaming through the AI filter (kept per-source
  batching intentionally, for API cost reasons).

## Current git state

Two commits so far (`init`, `feat: basic workshop`). As of this handoff,
`manifest.json` and `panel/panel.css` have **uncommitted** changes (the
`<dialog>` CSS fix above). Check `git status` before building on top, and
consider whether those should be committed first.

## Where to go next

Read [AGENTS.md](../AGENTS.md) in full — it has the numbered
"customization map" (what to change where for common asks) and the
platform gotchas list. [README.md](../README.md) is the user-facing
equivalent. [docs/ux-overview.md](ux-overview.md) is a UX audit snapshot
(may drift from the code faster than this file or AGENTS.md — treat it as
directional, verify against the actual UI for anything load-bearing).
