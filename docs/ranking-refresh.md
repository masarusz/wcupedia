# FIFA ranking refresh — procedure

The monthly check (`scripts/monthly-ranking-check.sh <notify-dir>`) only *detects*
a new FIFA/Coca-Cola Men's World Ranking: exit 0 NOOP, 3 NEW, 2 HOLD, 1 BROKE.
It never changes the repo. When it reports **NEW**, a staff session follows this
procedure. All paths are relative to the repository root.

The first refresh (2026-10-08, v1.3.1) found a points value wrong in the English
Wikipedia module. Assume either source can be wrong.

Outcomes while refreshing: **HOLD** (needs the owner: a disagreement you cannot
settle, a new country name, a code change) or **BROKE** (a step failed). On either,
stop, deploy nothing, leave the working tree as is, and report raw output.
Never widen or edit a test; never edit `tests/golden/*` except `tests/golden/fifa.json`
as described in step 3.

## 1. Repo preflight

On branch `main`, `git status --porcelain` empty, `git fetch` and `main == origin/main`.
Otherwise HOLD. Run `node tests/run.mjs` once and note the passed count as the baseline.

## 2. Rebuild `curated/fifa-ranking.json`

Source: `https://en.wikipedia.org/w/index.php?title=Module:SportsRankings/data/FIFA_World_Rankings&action=raw`
(send `User-Agent: wcupedia-refresh/1.0`). `data.rankings` holds rows
`{ "English name", rank, movement, points }` plus a name→code table and the
`data.updated` / `data.previous` / `data.next` dates.

Keep the file's shape exactly: `_about`, `releaseDate`, `previousDate`, `nextUpdate`
(from `data.next`), `source`, `sourceLicence` ("CC BY-SA 4.0"), `publisher` ("FIFA"),
`_discrepancies`, `rows`. Update any dates named in the `_about` prose.

Each row: `{rank, points, move: "up"|"down"|"same", moveBy?}` plus EITHER `team`
(a key in `public/data/teams.json`) OR `name` (Japanese) + `flag` (ISO alpha-2).
Copy how `move`/`moveBy` are written from the existing rows.

- Map ranked countries to team keys by matching the module's English name against
  `en` in `public/data/teams.json`. Do **not** write a FIFA-code→ISO table — FIFA codes
  differ from ISO (POR/PRT, NED/NLD, KSA/SAU…). Known aliases: Türkiye→Turkey,
  Côte d'Ivoire→Ivory Coast, Korea Republic→South Korea, Korea DPR→North Korea,
  Congo DR→DR Congo, IR Iran→Iran, Aotearoa New Zealand→New Zealand,
  USA→United States, Czechia→Czech Republic.
- Countries with no page: carry over `name` and `flag` from the current file.
- A country **newly** in the ranking and not in the current file → HOLD: Japanese
  names are the owner's call. Propose one from en.wikipedia langlinks
  (`action=query&prop=langlinks&lllang=ja`) in its everyday short form (中国, not
  中華人民共和国; タイ, not タイ王国), with its ISO alpha-2 from Wikidata P297. Never
  blanket-strip 共和国 — ドミニカ共和国 ≠ ドミニカ国, コンゴ共和国 ≠ コンゴ民主共和国.
  Report any country that dropped out.
- The row count must stay 211 (the build guard expects it). Otherwise HOLD.

## 3. Cross-check (required)

Compare rank and points of every row in the ja.wikipedia top-55 table
(`https://ja.wikipedia.org/w/index.php?title=FIFA%E3%83%A9%E3%83%B3%E3%82%AD%E3%83%B3%E3%82%B0&action=raw`)
with the rebuilt rows, programmatically. First confirm the ja table shows the same
release date; if not, it has not caught up — HOLD and retry in a few days.

For each disagreement, query FIFA's own ranking API:
`https://api.fifa.com/api/v3/fifarankings/rankings/rankingsbyschedule?rankingScheduleId=<id>&language=en`
(211 rows: `IdCountry` FIFA code, `Rank`, `PrevRank`, `TotalPoints` to 6 decimals).
**Schedule ids are named after the previous release**: the 18 Nov 2026 release is
`FRS_Male_Football_20261007`. The list of ids, each with its publication `date`, is
embedded in the HTML of `https://inside.fifa.com/fifa-rankings/world-ranking/men`
(grep `"id":"FRS_Male_Football_`). Do not use `api/v3/rankings/?rankingScheduleId=`:
it ignores the parameter and silently returns an older release.
Compare movement too: the en module has carried the previous release's movement for
rows whose rank did not change (2026-11-18: three rows); FIFA's `PrevRank` settles it.
If FIFA's value matches one side exactly (2 decimals), use it and record
the reasoning in `_discrepancies`, in the style of the existing entry. API
unreachable or matching neither side → HOLD. More than 3 disagreements → HOLD.
If ja/en disagree, es.wikipedia and fr.wikipedia may also help; a points value
higher than the rank above it is wrong.

Rewrite `tests/golden/fifa.json` (same shape) from the **ja.wikipedia table** as the
independent oracle — never from the curated file, except a FIFA-API-settled value,
noted as such. Set its `releaseDate` and `nextUpdate` from the ja article (the table
caption and 次回発表予定日; confirm `nextUpdate` equals the module's `data.next`).
`tests/views-render.test.mjs` takes the expected 「…発表」 and 「次回は…」 text from
these two golden fields, and `tests/ranking-check.test.mjs` builds its CLI fixtures
from the curated file's own dates, so neither test needs editing on a refresh.

## 4. Flags

Every `flag` value needs `public/assets/flags/<code>.svg`. Download a missing one from
`https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/<code>.svg` (MIT, already
credited); each file must start with `<svg` and contain `viewBox`. In zsh,
`for x in $VAR` does not word-split: use `while IFS= read -r`, and end the list file
with a newline or the last entry is skipped.

## 5. Build and test

`node tools/build-data.mjs`, `node tests/run.mjs`, `node tests/mutate.mjs`. Read the
last lines yourself: `N passed, 0 failed` with N ≥ the baseline, and
`mutations: N/N killed`. `git diff --stat` may touch only `curated/fifa-ranking.json`,
`public/data/fifa-ranking.json`, `tests/golden/fifa.json` and new flag SVGs; anything
else → HOLD. A data-shape change needs code, and code goes to Codex.

## 6. Version bump (patch)

Read X.Y.Z from `public/js/version.js`, set Z+1. Replace **only** these exact forms:
`'X.Y.Z'` in `public/js/version.js`; `?v=X.Y.Z` in `public/index.html`,
`public/manifest.webmanifest`, `public/js/*.js`; the version assertions in
`tests/*.mjs`. **Never run a replace over `public/assets`**: about 20 flag SVGs contain
digit runs like `1.3.1` as path coordinates and would be corrupted. Then
`grep -rn -F "<old version>" public/index.html public/manifest.webmanifest public/js tests`
must print nothing.

README: update the `> Status: vX.Y.Z` line and add, at the top of `## Changelog`:

```
### vX.Y.Z — <today>

- FIFAランキング updated to the <D Month YYYY> release (was <previous>).
  The next release is due on <data.next>.
```

plus a bullet for any FIFA-API-settled discrepancy. Re-run `node tests/run.mjs`.

## 7. Browser verification

Preview config `wcupedia` (`.claude/launch.json`, serves `public/` on port 4182).
Open a **fresh** tab at `http://localhost:4182/?cb=<timestamp>#/r/c/fifa` (the console
buffer survives reloads). A hidden pane blanks screenshots and stalls timers —
measure with JavaScript, synchronously. Check:

- the loaded `version.js` / `views.js` carry the new `?v=` and `transferSize > 0`;
- 211 ranking rows;
- 0 ranking images with `naturalWidth === 0` (re-run the probe in a later call once
  images are complete). A past release shipped 131 broken flags with green tests;
- the release date shown is the new date;
- no rendered text node contains a literal `{` or `|`;
- no horizontal scroll at 768 and 1180 px wide;
- no console errors in that fresh tab.

## 8. Ship

`./audit-before-push` (local-only, repo root) must print AUDIT PASSED. Commit as
`Refresh the FIFA ranking to the <YYYY-MM-DD> release; vX.Y.Z` (no personal names,
paths or e-mail). `git push origin main`, then `./scripts/deploy.sh` and require its
`Deploy verified` line — otherwise stop and do not tag. Only then tag `vX.Y.Z`, push the
tag, re-run the audit, and confirm the live `js/version.js` serves the new version.

Report: the new date, who is #1, where Japan sits, countries that entered or left.
