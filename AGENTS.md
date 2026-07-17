# AI Web Tracker: instructions for coding agents

This repository is a no-build Chrome Extension (Manifest V3) for collecting
items from website list pages, opening detail pages when needed, filtering new
items, and showing the results in the extension panel.

The main workshop scenario is job tracking, but the same architecture can be
used for products, classifieds, real estate, tenders, and other catalog-like
sites.

## Project shape

- `manifest.json` defines the MV3 extension, permissions, background service
  worker, action icon, and optional host permissions.
- `background/service-worker.js` opens/focuses the panel tab, runs scans,
  checks host permissions, applies filters, stores new items, updates the badge,
  and sends progress events.
- `panel/` contains the extension UI:
  - `panel.html` is the main page.
  - `tabs.js` switches top-level tabs. On each panel open, Main is the default.
  - `tab-main.js` owns Scan now, Stop, live progress, Just found, and the
    History/Logs buttons.
  - `tab-searches.js` powers the visible Searches tab and handles Add search.
  - `tab-filters.js` stores keyword, minus-word, and AI filter settings.
  - `tab-profile.js` powers the visible Setting tab: OpenAI API key and
    Resume/CV.
  - `tab-history.js` and `tab-logs.js` open modal windows from Main.
  - `item-card.js` renders item cards used by Main and History.
- `parsers/` contains source definitions and the tab crawler:
  - `example-single-phase.js` collects enough data from the list page.
  - `example-two-phase.js` collects links from a list page and details from
    each item page.
  - `searches.js` stores saved searches, validates that their URLs belong to
    supported sources, and maps each search to the matching hardcoded parser(s).
  - `index.js` registers hardcoded supported sources only.
  - `tab-crawler.js` opens real browser tabs and injects extraction functions.
  - `parser-interface.js` documents the source contract.
- `filters/` contains keyword, minus-word, AI, and pipeline filtering.
- `storage/` contains IndexedDB result storage and local log storage.
- `docs/` contains supporting documentation for agents and workshop users.

There is no package install, bundler, dev server, or test runner in this repo.
Do not add one unless the user explicitly asks for a larger architecture change.

## Source model

A source is an object with:

- `originPattern`: host permission pattern such as `https://remoteok.com/*`.
- `originPatterns`: optional list of host permission patterns.
- `listUrls`: one or more list/catalog URLs.
- `extractLinks()`: function injected into each list tab. It returns
  `{ url, title, meta?, postedAt?, details? }[]`.
- `extractDetail()`: optional function injected into each new item tab. It
  returns `{ description?, postedAt?, details? }`.
- `maxEntities`: optional per-source cap. The crawler default is 10.

The crawler opens real tabs with `chrome.tabs.create({ active: false })`.
Extraction functions run inside target pages through
`chrome.scripting.executeScript`, so they must be self-contained: no imports,
no closures over module variables, and no extension-only APIs.

The final saved item shape is assembled in `background/service-worker.js`:

`{ id, url, title, meta, description, postedAt, details, source, foundAt, matchedKeywords, aiVerdict }`

The default unique id is the normalized URL from `storage/db.js`.

## Supported sources and saved searches

Supported sources live in files under `parsers/` and are registered in
**two** registries that must both be kept in sync — they are not
alternatives:

- `parsers/index.js` (`SOURCES`): the canonical list mentioned in
  `parsers/parser-interface.js`-style docs. Its `getAllSources()`/
  `isSupportedSource()` helpers are currently unused elsewhere in the
  codebase (verified by grep) — registering here alone does not make a
  source selectable from the UI.
- `parsers/searches.js` (`SUPPORTED_SOURCES`): this is the registry that
  actually gates the "+ Add search" UI. `parseSupportedUrls()` matches a
  saved search's URLs by `URL.origin` against this map's `origin` field; a
  source missing here throws "Unsupported site" when a user tries to save
  a search for it, regardless of what `parsers/index.js` contains.

A new file-based source must be added to both. See the "Add search
workflow" below for the exact steps.

Current built-ins (all registered in both files):

- `example-single-phase`: Hacker News jobs, list-only (demo/template).
- `example-two-phase`: Remote OK jobs, list page plus detail extraction (demo/template).
- `weworkremotely`: We Work Remotely, list page plus detail extraction.
- `euremotejobs`: EU Remote Jobs, list page plus detail extraction.
- `aijobs`: aijobs.com, list page plus detail extraction.

Saved searches added from the UI live in `chrome.storage.local` under
`searches.saved`. The Add search dialog intentionally asks only for `Name` and
`List URLs`; each URL must belong to one of the supported sources. A single
saved search may include URLs from several supported sources; at scan time it is
split into crawler runs backed by the matching hardcoded parsers in
`parsers/searches.js`.

If a site needs reliable site-specific selectors, prefer a built-in parser file
instead of expanding the Add search UI.

## Filtering and OpenAI

Filtering runs in `filters/pipeline.js` in this order:

1. `filters/keyword-filter.js`
2. `filters/minus-word-filter.js`
3. `filters/ai-filter.js`

Keyword and minus-word filters currently check only `title`.

The AI filter uses OpenAI Chat Completions through a plain `fetch` call in
`filters/ai-filter.js`. It receives title, meta, a description snippet, the
user's selection criteria from Filters, and optional CV text from Setting. The
API key and CV text are stored locally in `chrome.storage.local` as
`profile.openaiApiKey` and `profile.cvText`. Do not hardcode secrets.

Without an API key, the AI filter cannot be enabled from the UI. If the AI
filter is disabled, items pass through without OpenAI calls.

## Rules for adding or changing a source

1. Read `AGENTS.md`, `parsers/parser-interface.js`, and the closest existing
   parser before editing.
2. Use the user's browser or another browser tool when available. Inspect the
   live list page before writing selectors.
3. Identify the repeating list item container, stable detail link, title, meta,
   date, and any fields needed by filtering.
4. If detail pages exist, open at least one detail page and inspect the real
   content container. Avoid accidentally scraping "similar items" blocks.
5. Prefer semantic selectors and stable DOM structure over generated class names.
6. Reuse the existing source contract, crawler, storage, filters, and UI.
7. Do not create parallel architecture, new storage systems, or new build tools.
8. Keep source-specific logic inside the source parser file where possible.
9. Do not change unrelated parts of the project.
10. Bump `manifest.json` version after any code or documentation change.

Before implementation, state the plan: example source used as reference, files
to change, fields to extract, uniqueness strategy, pagination strategy, and
risks. After implementation, list changed files and checks performed.

## Browser workflow for parser work

When browser access is available:

- Open the list URL in the normal browser session.
- Inspect the repeating cards with the DOM/console.
- Verify selectors using `document.querySelectorAll(...)`.
- Open one detail URL and verify detail selectors.
- Check pagination or infinite scroll.
- Do not submit forms, mutate user data, or perform unsafe actions unless the
  user explicitly requests it.

When browser access is not available:

- Ask for the list URL and representative HTML, or work from provided HTML.
- Clearly state that selector confidence is limited.

## Add search workflow

For a quick generic saved search:

1. Open the Searches tab.
2. Click `+ Add search`.
3. Enter `Name`.
4. Enter one or more `List URLs`, one URL per line. They must belong to domains
   supported by `parsers/searches.js`.
5. Save, grant requested host permissions, then run `Scan now` on Main.

For a durable source:

1. Copy `parsers/example-single-phase.js` or `parsers/example-two-phase.js`.
2. Set `originPattern` and `listUrls`.
3. Implement `extractLinks` and, when needed, `extractDetail`.
4. Register the parser in `parsers/index.js` (`SOURCES`).
5. Register the same parser in `parsers/searches.js` (`SUPPORTED_SOURCES`),
   with a `label` and an `origin` (scheme + host, no path) — this step is
   required for the source to be usable from the "+ Add search" UI; skipping
   it means every saved search for that domain fails with "Unsupported site".
6. Add the new domain to `host_permissions` in `manifest.json` if you want it
   granted upfront (optional — `optional_host_permissions` already covers
   `https://*/*`, so Chrome will still prompt on first `Scan now` either way).
7. Reload the unpacked extension in `chrome://extensions`.
8. Add a saved search (Searches tab → "+ Add search") pointing at the new
   source's list URL(s), or reuse an existing one.
9. Run `Scan now`.
10. Check Logs and History from the Main tab buttons.

## Readiness checklist for a new source

A source is ready when:

- It appears in the Searches UI.
- Its list URLs are saved and clickable.
- Required host permissions are requested from a user click.
- It opens the intended list URL(s).
- It extracts stable item URLs and titles.
- It handles missing optional data.
- It avoids duplicates using the existing normalized URL id, or documents any
  deliberate id strategy change.
- It extracts detail text when needed for AI filtering.
- It passes data through the existing filters.
- It does not break existing sources.
- Available syntax checks pass.

## Useful checks

There is no formal build. Use focused checks:

- `node --check <file.js>` for changed JavaScript files.
- Parse `manifest.json` as JSON after version changes.
- Use the extension manually after reload for end-to-end behavior.

Always use yarn for JavaScript package management if package management ever
becomes necessary. Do not use `npm install`, `npm i`, or `npx`.
