import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import golden from './golden/phase4.json' with { type: 'json' };
import { applySquadChanges, playerTieOrder, rankRows, resolveLineups2026 } from '../tools/lib/phase4.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, 'public/data', name), 'utf8'));
const players = load('players.json');
const teams = load('teams.json');
const rankings = load('rankings.json');
const tournament2026 = load('t/2026.json');

function playerId(reference) {
  if (!reference.startsWith('2026:')) return reference;
  const [, team, name] = reference.split(':');
  const matches = Object.entries(players).filter(([, player]) => player.name === name && player.teams.includes(team) && player.years.includes(2026));
  if (matches.length !== 1) throw new Error(`cannot resolve golden 2026 player ${reference}`);
  return matches[0][0];
}

function rankingGroups(rows, title = false, tournament = false) {
  const byRank = Map.groupBy(rows, (row) => row.rank);
  return [...byRank].map(([rank, members]) => ({
    rank,
    members: members.map((row) => `${row.player || row.team}${tournament ? `@${row.year}` : ''}`).sort(),
    value: title ? [members[0].value, members[0].runnerUp] : members[0].value,
  }));
}

function assertGroups(deepEqual, actualRows, expected, options = {}) {
  const actual = rankingGroups(actualRows, options.title, options.tournament);
  for (const group of expected) {
    const normalized = { ...group, members: group.members.map((member) => {
      if (!options.tournament) return playerId(member);
      const at = member.lastIndexOf('@');
      return `${playerId(member.slice(0, at))}${member.slice(at)}`;
    }).sort() };
    deepEqual(actual.find((item) => item.rank === group.rank), normalized, `rank ${group.rank}`);
  }
}

export function register(test, equal, deepEqual) {
  test('Phase 4 golden country rankings, Japan ranks, regions and country records', () => {
    const metricMap = { titles: 'titles', appearances: 'appearances', wins: 'wins', goals: 'goals' };
    for (const [goldenMetric, actualMetric] of Object.entries(metricMap)) {
      const expected = golden.countryRankings[goldenMetric];
      equal(rankings.countries[actualMetric].length, expected.rows, `${goldenMetric} rows`);
      assertGroups(deepEqual, rankings.countries[actualMetric], expected.top, { title: goldenMetric === 'titles' });
      if (expected.JPN) {
        const japan = rankings.countries[actualMetric].find((row) => row.team === 'JPN');
        deepEqual({ rank: japan.rank, value: japan.value }, expected.JPN, `${goldenMetric} JPN`);
      }
    }
    const roots = Object.entries(teams).filter(([, team]) => !team.successor);
    equal(roots.length, golden.regions.roots, 'region roots');
    const counts = Object.fromEntries([...Map.groupBy(roots, ([, team]) => team.region)]
      .map(([region, rows]) => [region, rows.length]).sort());
    deepEqual(counts, golden.regions.counts, 'region counts');
    for (const [team, region] of Object.entries(golden.regions.sample)) equal(teams[team].region, region, team);

    const finishSource = { r16: 'round of 16' };
    for (const [team, expected] of Object.entries(golden.countries)) {
      const actual = teams[team];
      if (expected.tournaments) deepEqual(actual.tournaments.map((row) => String(row.year)), expected.tournaments, `${team} tournaments`);
      if (expected.bestFinishFjelstul) equal(finishSource[actual.bestFinish] || actual.bestFinish, expected.bestFinishFjelstul, `${team} best finish`);
      if (expected.titlesWithPredecessors !== undefined) equal(actual.titlesWithPredecessors, expected.titlesWithPredecessors, `${team} lineage titles`);
      if (expected.appearancesWithPredecessors !== undefined) equal(actual.tournaments.length, expected.appearancesWithPredecessors, `${team} lineage appearances`);
      if (expected.appearances !== undefined) equal(actual.tournaments.length, expected.appearances, `${team} appearances`);
      if (expected.titles !== undefined) equal(actual.titles, expected.titles, `${team} own titles`);
      if (expected.record) deepEqual(actual.record, expected.record, `${team} record`);
      if (expected.recordWithPredecessors) deepEqual(actual.record, expected.recordWithPredecessors, `${team} lineage record`);
      if (expected.recordOwn) deepEqual(actual.recordOwn, expected.recordOwn, `${team} own record`);
      if (expected.successor) equal(actual.successor, expected.successor, `${team} successor`);
      if (expected.opponents) {
        const opponents = Object.fromEntries(actual.opponents.map((row) => [row.team, { p: row.p, w: row.w, d: row.d, l: row.l }]));
        deepEqual(opponents, expected.opponents, `${team} opponents`);
      }
    }
  });

  test('Phase 4 golden player rankings and named player details', () => {
    const metricMap = {
      allTimeGoals: ['goals', false], tournamentGoals: ['tournamentGoals', true], awards: ['awards', false],
      squads: ['squads', false], appearances: ['apps', false],
    };
    for (const [goldenMetric, [actualMetric, tournament]] of Object.entries(metricMap)) {
      assertGroups(deepEqual, rankings.players[actualMetric], golden.playerRankings[goldenMetric].top, { tournament });
    }
    for (const [id, expected] of Object.entries(golden.players)) {
      const actual = players[id];
      equal(actual.name, expected.name, `${id} name`);
      deepEqual(actual.years, expected.squadYears, `${id} years`);
      equal(actual.goals, expected.goals, `${id} goals`);
      deepEqual(actual.goalsByYear, expected.goalsByYear, `${id} goalsByYear`);
      equal(Object.hasOwn(actual, 'apps') ? actual.apps : null, expected.appearances, `${id} appearances`);
      deepEqual(Object.hasOwn(actual, 'appsByYear') ? actual.appsByYear : null, expected.appearancesByYear, `${id} appearancesByYear`);
      deepEqual(actual.awards, expected.awards, `${id} awards`);
      if (expected.number2026 !== undefined) {
        const member = Object.values(tournament2026.squads).flat().find((row) => row.player === id);
        equal(member.no, expected.number2026, `${id} 2026 number`);
      }
    }
    equal(Object.values(players).some((player) => player.name === 'Tino Livramento'), false, golden.tinoLivramento2026);
    deepEqual(rankings.appearanceTotalsByYear, golden.appearanceTotalsByYear, 'appearance totals by year');
    for (const [team, expected] of Object.entries(golden.crossCheck2026AppearancesVsWikipedia)) {
      const matches = tournament2026.matches.filter((match) => match.home === team || match.away === team).length;
      const teamPlayers = Object.values(players).filter((player) => player.teams.includes(team) && player.years.includes(2026) && player.appsByYear?.[2026] > 0);
      equal(matches, expected.matchesChecked, `${team} matches checked`);
      equal(teamPlayers.length, expected.players, `${team} players appeared`);
      equal(teamPlayers.reduce((sum, player) => sum + player.appsByYear[2026], 0), expected.appearances, `${team} appearances`);
      deepEqual([], expected.mismatches, `${team} mismatches`);
    }
  });

  test('Phase 4 ranking tie order and top-50 cutoff rules', () => {
    const tied = rankRows([
      { player: 'old', value: 5, recentYear: 2018, name: 'Zulu' },
      { player: 'latin-b', value: 5, recentYear: 2026, name: 'Bravo' },
      { player: 'latin-a', value: 5, recentYear: 2026, name: 'Álpha' },
    ], { secondary: playerTieOrder });
    deepEqual(tied.map((row) => [row.rank, row.player]), [[1, 'latin-a'], [1, 'latin-b'], [1, 'old']], 'player tie order');
    const rows = Array.from({ length: 49 }, (_, index) => ({ id: `u${index}`, value: 100 - index }));
    rows.push({ id: 'tie-a', value: 1 }, { id: 'tie-b', value: 1 }, { id: 'tie-c', value: 1 });
    const cut = rankRows(rows, { limit: 50 });
    equal(cut.length, 52, 'rank-50 tie retained');
    equal(cut.slice(-3).every((row) => row.rank === 50), true, 'shared rank 50');
  });

  test('Phase 4 squad-change and unresolved-line-up failures are strict', () => {
    const roster = [{ team: 'AAA', name: 'Out', date_of_birth: '2000-01-01', number: 1, pos: 'GK' }];
    const change = { team: 'AAA', out: { name: 'Out', dateOfBirth: '2000-01-01' }, in: { name: 'In', dateOfBirth: '2001-01-01', number: 2, pos: 'DF' } };
    deepEqual(applySquadChanges(roster, [change]).map((row) => row.name), ['In'], 'change applied');
    let missing = '';
    try { applySquadChanges([], [change]); } catch (error) { missing = error.message; }
    equal(missing.includes('out missing'), true, 'out missing failure');
    let duplicate = '';
    try { applySquadChanges([...roster, { team: 'AAA', name: 'In', date_of_birth: '2001-01-01' }], [change]); } catch (error) { duplicate = error.message; }
    equal(duplicate.includes('in already present'), true, 'in already present failure');
    const lineup = [{ team1: 'AAA', team2: 'BBB', lineup: [
      { starter: [{ name: 'Known' }], bench: [], subs: [{ on: 'Missing', off: 'Known' }] },
      { starter: [], bench: [], subs: [] },
    ] }];
    let unresolved = '';
    try { resolveLineups2026(lineup, (name) => name, (name) => name === 'Known' ? { id: 'known' } : null); } catch (error) { unresolved = error.message; }
    equal(unresolved.includes('AAA: Missing'), true, 'unresolved line-up named');
    const counts = resolveLineups2026([{ team1: 'AAA', team2: 'BBB', lineup: [
      { starter: [{ name: 'Starter' }], bench: [{ name: 'Sub' }], subs: [{ on: 'Sub', off: 'Starter' }] },
      { starter: [], bench: [], subs: [] },
    ] }], (name) => name, (name) => ({ id: name }));
    deepEqual(Object.fromEntries(counts), { Starter: 1, Sub: 1 }, 'appearances are starters plus substitutes on');
  });
}
