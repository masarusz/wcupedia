import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import golden from './golden/meikan.json' with { type: 'json' };
import { extractClub, matchSquadClubEntry, parseSquadWikitext } from '../tools/lib/players-ja.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = join(ROOT, 'public/data');
const load = (path) => JSON.parse(readFileSync(join(DATA, path), 'utf8'));

export function register(test, equal, deepEqual) {
  test('golden player-guide clubs, shirts, positions, and coverage', () => {
    const headings = JSON.parse(readFileSync(join(ROOT, 'curated/team-headings-ja.json'), 'utf8'));
    const players = load('players.json');
    const parsedByYear = new Map();
    const clubYears = new Set(golden.yearsWithClubs);
    for (const [yearText, expected] of Object.entries(golden.squadPageCounts)) {
      const year = Number(yearText);
      const entries = parseSquadWikitext(readFileSync(join(ROOT, `.cache/sources/wikipedia/squads/squads-${year}.wiki`), 'utf8'), year, headings);
      parsedByYear.set(year, entries);
      deepEqual({ squadEntries: entries.length, withClub: entries.filter((entry) => entry.club).length }, expected, `${year} source page`);
    }
    for (const { year } of load('tournaments.json')) {
      const members = Object.values(load(`t/${year}.json`).squads).flat();
      const withClub = members.filter((member) => member.club).length;
      if (clubYears.has(year)) equal(withClub / members.length >= 0.99, true, `${year}: ${withClub}/${members.length}`);
      else equal(withClub, 0, `${year} has no squad-page clubs`);
    }
    for (const sample of golden.samples) {
      const member = load(`t/${sample.year}.json`).squads[sample.team].find((item) => item.player === sample.player);
      equal(Boolean(member), true, `${sample.year} ${sample.team} ${sample.player}`);
      equal(member.club, sample.club, `${sample.player} club`);
      const squad = load(`t/${sample.year}.json`).squads[sample.team];
      const candidates = squad.map((item) => ({
        id: item.player, no: item.no, birthDate: players[item.player].birthDate || null, name: players[item.player].name,
      }));
      const sourceEntry = parsedByYear.get(sample.year).find((entry) => entry.team === sample.team
        && matchSquadClubEntry(entry, candidates).id === sample.player);
      equal(Boolean(sourceEntry), true, `${sample.player} source match`);
      equal(sourceEntry.pos, sample.pos, `${sample.player} source position`);
      equal(sourceEntry.no == null ? '-' : String(sourceEntry.no), sample.shirt, `${sample.player} source shirt`);
    }
  });

  test('club extraction handles both parameter layouts and removes wiki decoration', () => {
    equal(extractClub('[[CRヴァスコ・ダ・ガマ|ヴァスコ・ダ・ガマ]]'), 'ヴァスコ・ダ・ガマ');
    equal(extractClub("{{flagicon|Italy}} [[ACミラン|'''ミラン''']]<ref>x</ref>"), 'ミラン');
    const wiki = `
=== {{TESTf}} ===
{{サッカーナショナルチーム選手一覧 選手
|no=8
|pos=MF
|name=[[選手A]]
|原語表記=Player A
|age={{生年月日と年齢2|2022|11|20|1990|1|2}}
|club=[[クラブA|表示クラブA]]
|clubnat=JPN
}}
{{サッカーナショナルチーム選手一覧 選手|背番号=9|ポジション=FW|名前=[[選手B]]|原語表記=Player B|生年月日={{生年月日と年齢2|2022|11|20|1991|2|3}}|クラブ=[[クラブB]]|クラブ国籍=JPN}}
`;
    const entries = parseSquadWikitext(wiki, 2022, { TESTf: 'JPN' });
    deepEqual(entries.map(({ no, pos, club }) => ({ no, pos, club })), [
      { no: 8, pos: 'MF', club: '表示クラブA' },
      { no: 9, pos: 'FW', club: 'クラブB' },
    ]);
  });

  test('player-guide card facts are tournament-local and complete', () => {
    const players = load('players.json');
    for (const { year } of load('tournaments.json')) {
      const detail = load(`t/${year}.json`);
      for (const member of Object.values(detail.squads).flat()) {
        const player = players[member.player];
        equal(Number.isInteger(member.goals), true, `${year} ${member.player} goals`);
        equal(member.goals, player.goals, `${year} ${member.player} career goals`);
        equal(typeof member.photo, 'boolean', `${year} ${member.player} photo flag`);
        equal(Object.hasOwn(member, 'apps'), Object.hasOwn(player, 'apps'), `${year} ${member.player} matches availability`);
        if (Object.hasOwn(player, 'apps')) equal(member.apps, player.apps, `${year} ${member.player} career matches`);
        equal(Object.hasOwn(member, 'age'), Boolean(player.birthDate), `${year} ${member.player} age availability`);
      }
    }
  });

  test('player-guide CSS fixes three iPad columns and five wide columns', () => {
    const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
    equal(/@media \(min-width: 700px\)\s*\{\s*\.meikan-grid\s*\{\s*grid-template-columns:\s*repeat\(3,/s.test(css), true, 'three columns by 768px');
    equal(/@media \(min-width: 1180px\)\s*\{\s*\.meikan-grid\s*\{\s*grid-template-columns:\s*repeat\(5,/s.test(css), true, 'five columns at 1180px');
    equal(/\.meikan-card\s*\{[^}]*min-height:\s*44px/s.test(css), true, 'card tap target');
  });
}
