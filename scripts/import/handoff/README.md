# Handoff fixers

The itinerary and booking markdown arrives generated, and it breaks the parser the same
handful of ways every time. These scripts do the restructuring so the fixes are repeatable
instead of hand-edited each import. They are pure transformers — no trip data lives here.

The city-specific generator and the source export (`trip.json`, `routes.json`) live in
`content/_handoff/`, which is gitignored: they carry the accommodation address, host names
and booking references.

## fix_itin.py

    python3 fix_itin.py <in.md> <out.md> "Section A~Section B"

The third argument lists trailing `#` reference sections to drop (they are not day headings,
so the parser rejects them). It also:

- strips descriptive suffixes from block headings — `## Midday — the Sunday markets` → `## Midday`
- maps `## Afternoon` onto `## Midday`, the parser having no Afternoon block
- splits combined headings (`## Morning and midday`) at a marker row — see `COMBINED`
- folds `###` headings into bold prose, which imports as a note item on the day
- re-attaches table rows that prose separated from their table
- splits a time range in the Time cell into a start time plus the span in Details

## fix_bookings.py

    python3 fix_bookings.py <in.md> <out.md>

Merges the per-tier "to book" sections into one section 2 with a `**tier:**` field on each
entry, renumbers the sections to the five the parser wants, strips italic suffixes from
`### ID · title` headings, and rewrites any non-date `**for:**` (e.g. `unscheduled`) into a
`**when:**` field, since `for` must start with `YYYY-MM-DD`.

## gen_routes.py

    python3 gen_routes.py <city> <Trip Name> <out.md>

Builds the Walking-Routes markdown from `routes.json`. The generated routes file is prose
rather than field bullets, so regenerating from the JSON is cleaner than parsing it back.
Route ids must match `[A-Z]+\d+`, so the city prefix is dropped: `SV-S1` → `S1`.
