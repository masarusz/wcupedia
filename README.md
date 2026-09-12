# Wcupedia（ワールドカップペディア）

**Wカップ大図鑑** — a kid-friendly encyclopedia of every men's football World Cup,
1930–2026, in Japanese: tournaments, knockout charts, matches, goals and players.
Built for two children (aged 8 and 10) to browse on an iPad.

**Live site:** https://masarusz.github.io/wcupedia/

A static site: no accounts, no tracking, no server.

> Status: in development. Tournament, match and credits pages are done; country
> pages, player pages and search come next.

## Features

- Every tournament from 1930 to 2026: podium, top scorers and awards, group
  tables, and a TV-style knockout chart (final in the centre, both halves of the
  draw joined by lines) that can be stepped through round by round.
- Every match: score with extra time and penalty shoot-outs, and a goal timeline
  marking penalties and own goals.
- Japanese player names: Japan's players in kanji, other players in katakana with
  the Latin name in brackets, Latin only when no katakana is known.
- iPad-first layout with no horizontal scrolling; the knockout chart stacks its
  two halves when the screen is narrow.

## Data

The files in `public/data/` are generated from:

| Source | Years | License |
|---|---|---|
| [Fjelstul World Cup Database](https://github.com/jfjelstul/worldcup) v1.2.0, © 2023 Joshua C. Fjelstul, Ph.D. | 1930–2022 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode) |
| [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) | 2026 | CC0 1.0 |
| Japanese Wikipedia squad pages and article titles (player names in Japanese) | 1950, 1990–2026, plus article titles | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode) |

Modifications: the sources are filtered to men's tournaments, combined by year,
re-keyed, given Japanese names, and restructured into per-tournament JSON. The
generated data is therefore distributed under **CC BY-SA 4.0** — see
[DATA-LICENSE.md](DATA-LICENSE.md). Flags: [flag-icons](https://github.com/lipis/flag-icons)
(MIT) and public-domain historical flags from Wikimedia Commons. Code is MIT —
see [LICENSE](LICENSE).

## Development

Node.js 24 or later. No package dependencies.

```bash
node tools/fetch-sources.mjs     # download the pinned sources into .cache/sources
node tools/build-data.mjs        # generate public/data (deterministic)
node tests/run.mjs               # run the test suite
node tools/diff-sources.mjs      # cross-check the two match sources (reports/)
python3 -m http.server 4182 --directory public   # serve locally
```

## Deploy

```bash
./scripts/deploy.sh --dry-run    # show what would be published
./scripts/deploy.sh              # publish public/ to gh-pages and verify the live site
```

Only allowlisted files from `public/` are published. The script refuses to
deploy on a failing test suite, checks that the published branch contains
exactly the allowlist, verifies every file on the live site by checksum, and
confirms that unpublished paths return 404.

## Changelog

### v0.5.1 — 2026-09-12

- Player photos for 3,760 players, up from 67: every player whose English or
  Japanese Wikipedia article has a freely licensed lead photo with one clearly
  detectable face. Players without one keep the silhouette card. Every photo is
  credited to its photographer with its licence and a note that it was cropped
  and resized.
- Photos of players from the 1986 World Cup onwards are complete; earlier
  tournaments follow once their photos have been downloaded and reviewed.

### v0.5.0 — 2026-09-11

- 選手名鑑 (player guide): pick a World Cup, then a country, then browse its
  players as cards with photo, shirt number and position, age at that World
  Cup, club (from the 1950 and 1990–2026 squad lists on Japanese Wikipedia) and
  World Cup goals and matches. Filter by position; each card opens the player
  page.
- Player photos: freely licensed photos from Wikimedia Commons (CC0, public
  domain, CC BY, CC BY-SA), cropped around the face and self-hosted as small
  WebP images without metadata. Each photo is credited on the player page and
  on a photo credits page. Players without a suitable photo get a silhouette with
  their shirt number. This release includes the photos reviewed so far; more
  follow in a later update.
- Recent first: every list spanning several World Cups now shows the most
  recent first (country results, matches against an opponent, player awards,
  tournaments in search results, the 名鑑 tournament picker).
- Tournament and country pages link to their 選手名鑑.

### v0.4.1 — 2026-09-11

Changes from the children's first session on the iPad.

- 「‹ もどる」 back button in the header, because the Home Screen web app has no
  browser back button. It returns to the previous page, or to the natural parent
  when a page was opened directly.
- Player ages: birth date on the player page, the age at each World Cup (on the
  tournament's opening day), and new rankings for the youngest and oldest players
  in a World Cup squad. One wrong source birth date is corrected, and the build
  now refuses impossible ages.
- Countries on the match page, podium, host list and group tables link to their
  country page.
- Group tables fit iPad portrait with all columns visible, including 勝ち点.
- Player pages list the most recent World Cup first, headed with the full
  tournament name (e.g. 2018年 ロシア大会).

### v0.4.0 — 2026-09-11

- Search (検索): one box, in the menu and at the top of the home page, that finds
  countries, players and tournaments from hiragana, katakana, kanji or Latin
  letters. Results update while typing without disturbing Japanese input, and
  going back from a result restores the search.
- Results are ranked for "tap the first one": exact names first, then surname
  or given name, then names that start with or contain the query. Near-miss
  spellings (a missing small っ or ー, as in えむばっぺ for エムバペ) are found
  after exact matches, and a few nicknames are known (にっぽん, くりろな).
  Tournaments are also found by host country.
- The search index loads only when a search box is first used.

### v0.3.0 — 2026-09-11

- Country list (国), grouped by region (Asia, Europe, South America, North and
  Central America and the Caribbean, Africa, Oceania).
- Country pages: overall record, result at every World Cup, head-to-head record
  against every opponent with the matches between them, and the country's top
  scorers. Former teams (West Germany, Soviet Union, Yugoslavia,
  Czechoslovakia, Zaire, Serbia and Montenegro) keep their own pages and count
  towards their successor, following FIFA.
- Player pages: every World Cup with shirt number and position, goals with links
  to their matches, awards, and matches played (recorded from 1970; players
  from earlier World Cups show no count rather than a partial one).
- Rankings (ランキング): countries by titles, appearances, wins and goals;
  players by career goals, goals in one tournament, awards, World Cup squads
  and matches played. Penalty shoot-outs count as draws, as FIFA counts them.
- Player names link to player pages across the site.
- Data: 2026 late squad replacements (e.g. Shuto Machino for Wataru Endo) and
  the 2026 Silver and Bronze Ball and Boot winners added; 2026 line-ups
  resolved to players.

### v0.2.12 — 2026-09-11

- Soccer-ball app icon for "Add to Home Screen" on iPad, generated by
  `scripts/generate_icon.py` (Pillow), plus a web app manifest and iPad
  web-app meta tags so the site opens full screen from the Home Screen.
- Soccer-ball mark next to the Wcupedia title in the header.
- Podium rows aligned in fixed columns; more space above the awards; compact
  one-row header title; podium and awards panels stack on iPad portrait.
- README rewritten in English.

### v0.2.11 — 2026-09-11

First public release on GitHub Pages.

- Data: all 23 tournaments, 1,068 matches and 3,028 goals generated as verified JSON.
- Japanese text normalisation (kana, full/half width, accents) and a furigana
  markup parser (readings are kept in the data for kana search and not displayed).
- Pages: home (all 23 tournaments), tournament (results, top scorers, awards,
  group tables, knockout chart), match (score, extra time, penalties, goal
  timeline) and credits.
- iPad layout; flags (flag-icons MIT, historical flags public domain).
- TV-style knockout chart with round-by-round states ("before any match" through
  "after the final"); the two halves stack when the screen is narrow, with team
  names at 14 px or larger and no horizontal scrolling.
- Knockout stage shown above the group stages.
- Player names: Japan's players in kanji, other players as katakana (Latin),
  Latin only when no katakana is known.
- Top scorers and awards: award names and goal counts shown as coloured labels,
  distinct from player names.
