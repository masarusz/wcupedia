import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import golden from './golden/players-ja.json' with { type: 'json' };
import { fold } from '../public/js/fold.js?v=0.2.5';
import { playerLabel } from '../public/js/format.js?v=0.2.5';
import {
  articleJapaneseName, extractSquadName, matchSquadEntry, normalizeJapaneseName,
  parseSquadWikitext, validateJapaneseName,
} from '../tools/lib/players-ja.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const load = (path) => JSON.parse(readFileSync(join(ROOT, 'public/data', path), 'utf8'));

export function register(test, equal, deepEqual) {
  test('Japanese squad parser handles parameter and name variants', () => {
    const wiki = `
=== {{TESTf}} ===
{{サッカーナショナルチーム選手一覧 選手
|no=10
|pos=FW
|name=[[リオネル・メッシ|メッシ]] {{Captain|link=キャプテン (サッカー)}}<ref>{{cite web|x=y}}</ref>
|原語表記=Lionel Messi
|age={{生年月日と年齢2|2022|11|20|1987|6|24}}
}}
{{サッカーナショナルチーム選手一覧 選手|背番号=1|ポジション=GK|名前=[[キム・スンギュ]] [[ファイル:Captain sports.svg|12px|captain]]|生年月日={{生年月日と年齢2|df=yes|2022|11|20|1990|9|30}}}}
`;
    const entries = parseSquadWikitext(wiki, 2022, { TESTf: 'ARG' });
    equal(entries.length, 2);
    deepEqual({ no: entries[0].no, pos: entries[0].pos, birthDate: entries[0].birthDate, name: entries[0].name, source: entries[0].source },
      { no: 10, pos: 'FW', birthDate: '1987-06-24', name: 'メッシ', source: 'squad-label' });
    deepEqual({ no: entries[1].no, pos: entries[1].pos, birthDate: entries[1].birthDate, name: entries[1].name },
      { no: 1, pos: 'GK', birthDate: '1990-09-30', name: 'キム スンギュ' });
  });

  test('Japanese squad name extraction strips decorations and prefers common labels', () => {
    deepEqual(extractSquadName('[[T|L]] {{Captain|x=y}}'), { name: 'L', source: 'squad-label' });
    deepEqual(extractSquadName('{{仮リンク|ルイス・エレラ|en|Luis Herrera}}'), { name: 'ルイス エレラ', source: 'squad-title' });
    deepEqual(extractSquadName('{{仮リンク|ガビ (2004年生のサッカー選手)|label=ガビ|en|Gavi}}'), { name: 'ガビ', source: 'squad-label' });
    deepEqual(extractSquadName('[[孫興ミン|孫興慠]] (ソン・フンミン)'), { name: 'ソン フンミン', source: 'korea-kana' });
    deepEqual(extractSquadName('[[金承奎]]（キム・スンギュ）'), { name: 'キム スンギュ', source: 'korea-kana' });
    equal(extractSquadName('[[ハリー・ケイン]] [[ファイル:Captain sports.svg|12px]]<ref>x</ref>').name, 'ハリー ケイン');
    equal(normalizeJapaneseName('ハサン・アル＝ハイドゥース'), 'ハサン アル＝ハイドゥース');
  });

  test('article title qualifier years and katakana validation are strict', () => {
    deepEqual(articleJapaneseName('ガビ (2004年生のサッカー選手)', 2004), { name: 'ガビ', reason: null });
    equal(articleJapaneseName('リアム・ミラー (1999年生のサッカー選手)', 1981).name, null);
    deepEqual(articleJapaneseName('ロドリ (サッカー選手)', 1996), { name: 'ロドリ', reason: null });
    equal(validateJapaneseName('志尹南', 'PRK'), 'non-katakana');
    equal(validateJapaneseName('本田圭佑', 'JPN'), null);
  });

  test('squad identity matching uses team candidates, DOB, then shirt number', () => {
    const candidates = [
      { id: 'P-A', birthDate: '1996-06-22', no: 16 },
      { id: 'P-B', birthDate: '1996-06-22', no: 6 },
      { id: 'P-C', birthDate: '1995-01-01', no: 16 },
    ];
    deepEqual(matchSquadEntry({ birthDate: '1996-06-22', no: 16 }, candidates), { id: 'P-A', reason: null });
    equal(matchSquadEntry({ birthDate: '1996-06-22', no: null }, candidates).id, null);
    equal(matchSquadEntry({ birthDate: '1995-01-01', no: 99 }, candidates).id, null);
  });

  test('golden Japanese player names, 2026 squads, search keys, and display labels', () => {
    const players = load('players.json');
    const detail2026 = load('t/2026.json');
    const search = load('search.json').filter((item) => item.type === 'player');
    for (const [id, expected] of Object.entries(golden.byId)) equal(players[id].ja, expected.ja, id);
    for (const expected of golden.bySquad2026) {
      const member = detail2026.squads[expected.team].find(({ player }) => detail2026.people[player].name === expected.squadName);
      equal(Boolean(member), true, `${expected.team} ${expected.squadName}`);
      equal(detail2026.people[member.player].ja, expected.ja, `${expected.team} ${expected.squadName}`);
    }
    for (const expected of golden.searchKeys) {
      const query = fold(expected.query);
      const matches = search.filter((item) => item.keys.some((key) => key.includes(query))).map((item) => item.id);
      equal(matches.includes(expected.mustFind), true, `${expected.query}: ${matches.join(', ')}`);
    }
    for (const [id, expected] of Object.entries(golden.display)) {
      if (id.startsWith('_')) continue;
      const team = players[id].teams.includes('JPN') ? 'JPN' : players[id].teams[0];
      equal(playerLabel(players[id], team), expected, id);
    }
  });

  test('Japanese player-name invariants and tournament coverage floors', () => {
    const players = load('players.json');
    for (const [id, player] of Object.entries(players)) if (player.ja) {
      for (const forbidden of golden.neverInAnyJaName) equal(player.ja.includes(forbidden), false, `${id} contains ${forbidden}`);
      if (!player.teams.includes('JPN')) equal(validateJapaneseName(player.ja, player.teams[0]), null, id);
    }
    const rows = load('tournaments.json').map(({ year }) => {
      const detail = load(`t/${year}.json`);
      const ids = Object.values(detail.squads).flatMap((squad) => squad.map((member) => member.player));
      return { year, named: ids.filter((id) => detail.people[id].ja).length, total: ids.length };
    });
    console.log(`Japanese name coverage: ${rows.map((row) => `${row.year}=${row.named}/${row.total}`).join(' ')}`);
    for (const year of [2022, 2026]) {
      const row = rows.find((item) => item.year === year);
      equal(row.named / row.total >= 0.95, true, `${year}: ${row.named}/${row.total}`);
    }
  });
}
