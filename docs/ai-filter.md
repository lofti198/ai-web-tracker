# AI Filter

The AI filter is implemented in `filters/ai-filter.js` and is called from
`filters/pipeline.js` after the keyword and minus-word filters.

## Input Data

For every item that reaches the AI stage, the prompt can include:

- `title`
- `meta`
- the first `DESCRIPTION_SNIPPET_LENGTH` characters of `description`
- the user selection criteria from the Filters tab
- the first `CV_SNIPPET_LENGTH` characters of the Resume/CV text from Setting
  (note: the Resume/CV input block in `panel/panel.html` is currently
  commented out, so there is no UI to set `profile.cvText` right now — see
  `docs/HANDOFF.md` for details. The stored field is still read here if a
  value already exists from before the block was hidden.)

The current constants are:

- `BATCH_SIZE = 10`
- `DESCRIPTION_SNIPPET_LENGTH = 400`
- `CV_SNIPPET_LENGTH = 3000`

Only items that pass the cheaper local filters are sent to OpenAI. This keeps
API usage lower.

## User Criteria

The user writes the AI selection criteria in the Filters tab. The criteria are
stored in `chrome.storage.local` under `filters.config`, inside `aiFilter.prompt`.

Changing the criteria does not require code changes. Update the text in Filters
and click Save.

## OpenAI API Key

The key is entered on the Setting tab and stored locally in
`chrome.storage.local` as `profile.openaiApiKey`.

The key is sent only to `https://api.openai.com/v1/chat/completions` as a Bearer
token during AI filtering. Do not commit real keys or secrets.

If the key is missing, the UI prevents enabling the AI filter. If AI filtering is
disabled, no OpenAI request is made.

## Expected Model Output

`filters/ai-filter.js` requests JSON output in this shape:

```json
{
  "results": [
    { "index": 0, "match": true, "reason": "short explanation" }
  ]
}
```

The filter keeps only items where `match` is `true`. The `reason` becomes
`aiVerdict` and is shown as an AI filter badge in item cards.

## Errors And Limits

If an OpenAI batch fails, the current implementation logs a warning and drops
the items from that failed AI batch. This avoids showing unfiltered noise when
the user expected AI filtering.

To avoid unnecessary API calls:

- Keep keyword/minus-word filters enabled when they can narrow the list first.
- Keep `maxEntities` reasonable.
- Avoid sending huge descriptions; the filter already uses snippets.
- Do not run repeated scans against already-saved URLs unless testing a parser.

## Testing One Item

There is no dedicated test harness in this no-build extension. For manual
testing:

1. Add or use a source that produces one clear item.
2. Set a narrow AI criterion in Filters.
3. Add an API key on Setting.
4. Run `Scan now` from Main.
5. Open Logs from Main to confirm filtering behavior.
6. Open History from Main to inspect saved item fields and `AI filter` badge.

For code-level debugging, inspect `filters/ai-filter.js` and temporarily reason
from the `classifyBatch` input shape. Do not commit real API keys or temporary
debug secrets.
