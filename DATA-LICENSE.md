# Data license

The data files in `public/data/` and `curated/` are licensed under the
**Creative Commons Attribution-ShareAlike 4.0 International License**
(CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/legalcode

## Attribution

These files are derived from:

- **The Fjelstul World Cup Database** v1.2.0 by Joshua C. Fjelstul, Ph.D.
  © 2023 Joshua C. Fjelstul, Ph.D.
  https://github.com/jfjelstul/worldcup — licensed under CC BY-SA 4.0.
  Used for the 1930–2022 tournaments.
- **openfootball/worldcup.json** — dedicated to the public domain (CC0 1.0).
  https://github.com/openfootball/worldcup.json — used for the 2026 tournament.

## Modifications

- Restricted to the men's tournaments.
- 1930–2022 taken from the Fjelstul database and 2026 from openfootball; the two
  are combined by tournament, never within a match.
- Teams re-keyed per historical entity (e.g. West Germany and Germany are
  separate), with predecessor/successor links following FIFA's convention.
- 2026 players linked to earlier tournaments by team and date of birth.
- Japanese names and reading aids (furigana) added.
- Restructured into per-tournament, team, player, record and search JSON files.

No warranty is given for the accuracy of the data.
