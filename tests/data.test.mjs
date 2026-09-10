import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import facts from './golden/facts.json' with { type: 'json' };
import { foldCompact } from '../public/js/fold.js';
import { parseRuby } from '../public/js/ruby.js';
import { rawUrl, SOURCES } from '../tools/lib/sources.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = join(ROOT, 'public/data');
const load = (name, root = DATA) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const meta = load('meta.json');
const tournaments = load('tournaments.json');
const teams = load('teams.json');
const players = load('players.json');
const records = load('records.json');
const details = new Map(tournaments.map((item) => [item.year, load(`t/${item.year}.json`)]));
const allMatches = [...details.values()].flatMap((item) => item.matches.map((match) => ({ ...match, year: item.year })));
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sorted = (items) => [...items].sort(compare);
const score = (match) => [match.score.home, match.score.away];
const matchIndex = new Map(allMatches.map((match) => [match.id, match]));

function recursiveFiles(root, at = root) {
  return readdirSync(at, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.')).flatMap((entry) => {
    const path = join(at, entry.name);
    return entry.isDirectory() ? recursiveFiles(root, path) : [relative(root, path)];
  }).sort();
}

export function register(test, equal, deepEqual) {
  test('source raw URLs match golden URLs', () => {
    equal(Object.keys(facts.sources.rawUrls).length > 0, true);
    for (const [key, expected] of Object.entries(facts.sources.rawUrls)) {
      const separator = key.indexOf('/');
      const sourceName = key.slice(0, separator);
      const localFile = key.slice(separator + 1);
      equal(rawUrl(sourceName, localFile), expected, key);
    }
  });

  test('generated source attribution URLs match golden URLs', () => {
    equal(meta.sources.openfootball.url, facts.sources.openfootballUrl);
    equal(meta.sources.fjelstul.url, facts.sources.fjelstulUrl);
  });

  test('configured local source files exist', () => {
    for (const [sourceName, source] of Object.entries(SOURCES)) {
      equal(source.files.length > 0, true, sourceName);
      for (const { localFile } of source.files) {
        equal(existsSync(join(ROOT, '.cache/sources', sourceName, localFile)), true, `${sourceName}/${localFile}`);
      }
    }
  });

  test('golden totals', () => {
    equal(tournaments.length > 0 && allMatches.length > 0, true);
    equal(meta.counts.tournaments, facts.totals.tournaments);
    equal(meta.counts.matches, facts.totals.matches);
    equal(meta.counts.goals, facts.totals.goals);
    equal(allMatches.filter((match) => match.year <= 2022).length, facts.totals.matches1930to2022);
    equal(allMatches.filter((match) => match.year <= 2022).reduce((sum, match) => sum + match.goals.length, 0), facts.totals.goals1930to2022);
  });

  test('golden per-tournament facts', () => {
    equal(Object.keys(facts.tournaments).length > 0, true);
    for (const [year, expected] of Object.entries(facts.tournaments)) {
      const actual = tournaments.find((item) => item.year === Number(year));
      equal(Boolean(actual), true, year);
      deepEqual({
        teams: actual.teams, matches: actual.matches, goals: actual.goals, hosts: actual.hosts,
        champion: actual.placings['1'], runnerUp: actual.placings['2'], stages: actual.stages,
      }, expected, year);
    }
  });

  test('golden 2026 final', () => {
    const final = details.get(2026).matches.find((match) => match.stage === 'final');
    equal(Boolean(final), true);
    deepEqual({ home: final.home, away: final.away, score: [final.score.home, final.score.away], aet: final.score.aet, pens: final.score.pens }, facts.final2026);
  });

  test('golden 2026 teams by stage', () => {
    const tournament = details.get(2026);
    const at = (stage) => sorted(new Set(tournament.matches.filter((match) => match.stage === stage).flatMap((match) => [match.home, match.away])));
    deepEqual(at('r16'), sorted(facts.teams2026.r16));
    deepEqual(at('qf'), sorted(facts.teams2026.qf));
    deepEqual(at('sf'), sorted(facts.teams2026.sf));
    deepEqual(at('third'), sorted(facts.teams2026.thirdPlaceMatch));
    const groupF = tournament.groups.find((group) => group.name === 'Group F');
    deepEqual(sorted(groupF.standings.map((row) => row.team)), sorted(facts.teams2026.groupF));
    equal(groupF.standings.find((row) => row.pos === 3).advanced, facts.teams2026.groupFThirdAdvanced);
  });

  test('golden lineage', () => {
    equal(Object.keys(facts.lineage).length > 0, true);
    for (const [team, successor] of Object.entries(facts.lineage)) equal(teams[team].successor, successor, team);
  });

  test('golden title tables', () => {
    const own = Object.fromEntries(Object.entries(teams).filter(([, team]) => team.titles > 0).map(([key, team]) => [key, team.titles]));
    const inherited = Object.fromEntries(Object.entries(teams).filter(([, team]) => !team.successor && team.titlesWithPredecessors > 0).map(([key, team]) => [key, team.titlesWithPredecessors]));
    deepEqual(own, facts.titlesOwnKey);
    deepEqual(inherited, facts.titlesWithPredecessors);
  });

  test('golden Japan facts', () => {
    const japan = teams[facts.japan.key];
    equal(japan.tournaments.length > 0, true);
    deepEqual(japan.tournaments.map((item) => item.year), facts.japan.appearances);
    const rank = { champion: 11, 'runner-up': 10, third: 9, fourth: 8, sf: 7, qf: 6, r16: 5, r32: 4, 'second-group': 3, 'final-round': 2, group: 1 };
    const bestRank = Math.max(...japan.tournaments.map((item) => rank[item.finish]));
    const best = japan.tournaments.filter((item) => rank[item.finish] === bestRank);
    equal(best[0].finish, facts.japan.bestFinish);
    deepEqual(best.map((item) => item.year), facts.japan.bestFinishYears);
    equal(japan.tournaments.find((item) => item.year === 2026).finish, facts.japan.finish2026);
    const firstGoal = allMatches.filter((match) => match.year <= facts.japan.firstGoal.year)
      .flatMap((match) => match.goals.map((goal) => ({ ...goal, year: match.year, date: match.date })))
      .filter((goal) => goal.team === facts.japan.key).sort((a, b) => compare(a.date, b.date) || a.sort - b.sort)[0];
    deepEqual({ player: firstGoal.player, year: firstGoal.year }, facts.japan.firstGoal);
  });

  test('golden player facts', () => {
    equal(Object.keys(facts.players).length > 0, true);
    for (const [id, expected] of Object.entries(facts.players)) {
      const player = players[id];
      equal(Boolean(player), true, id);
      for (const [year, goals] of Object.entries(expected.goalsByYear)) equal(player.goalsByYear[year], goals, `${id} ${year}`);
      if (expected.total !== undefined) equal(player.goals, expected.total, `${id} total`);
      if (expected.maxInOneMatch !== undefined) {
        const max = Math.max(...allMatches.map((match) => match.goals.filter((goal) => goal.player === id && !goal.ownGoal).length));
        equal(max, expected.maxInOneMatch, `${id} max in match`);
      }
    }
  });

  test('golden all-time top scorer', () => {
    equal(records.allTimeScorers.length > 0, true);
    deepEqual(records.allTimeScorers[0], facts.allTimeTopScorer);
  });

  test('golden records through 2022', () => {
    const matches = allMatches.filter((match) => match.year <= 2022);
    equal(matches.length > 0, true);
    const margin = (match) => Math.abs(match.score.home - match.score.away);
    const total = (match) => match.score.home + match.score.away;
    const maxMargin = Math.max(...matches.map(margin));
    equal(maxMargin, facts.records1930to2022.maxMargin);
    const marginMatches = matches.filter((match) => margin(match) === maxMargin).map((match) => ({ year: match.year, home: match.home, away: match.away, score: [match.score.home, match.score.away] }));
    deepEqual(marginMatches, facts.records1930to2022.maxMarginMatches);
    const maxGoals = Math.max(...matches.map(total));
    equal(maxGoals, facts.records1930to2022.maxGoalsInMatch);
    deepEqual(matches.filter((match) => total(match) === maxGoals).map((match) => ({ year: match.year, home: match.home, away: match.away, score: [match.score.home, match.score.away] })), facts.records1930to2022.maxGoalsInMatchMatches);
    equal(matches.filter((match) => match.score.pens).length, facts.records1930to2022.penaltyShootouts);
    const scorerByTournament = new Map();
    for (const match of matches) for (const goal of match.goals) if (!goal.ownGoal) {
      const key = `${goal.player}\0${match.year}`;
      scorerByTournament.set(key, (scorerByTournament.get(key) || 0) + 1);
    }
    const bestTournament = [...scorerByTournament].map(([key, goals]) => { const [player, year] = key.split('\0'); return { player, year: Number(year), goals }; })
      .sort((a, b) => b.goals - a.goals || a.year - b.year || compare(a.player, b.player))[0];
    deepEqual(bestTournament, facts.records1930to2022.mostGoalsOneTournament);
    const perMatch = matches.flatMap((match) => [...new Set(match.goals.filter((goal) => !goal.ownGoal).map((goal) => goal.player))].map((player) => ({ player, year: match.year, goals: match.goals.filter((goal) => !goal.ownGoal && goal.player === player).length })));
    deepEqual(perMatch.sort((a, b) => b.goals - a.goals || a.year - b.year || compare(a.player, b.player))[0], facts.records1930to2022.mostGoalsOneMatch);
  });

  test('goals equal scores in 1068 matches', () => {
    equal(allMatches.length, 1068, `checked ${allMatches.length} matches`);
    for (const match of allMatches) {
      equal(match.goals.filter((goal) => goal.team === match.home).length, match.score.home, `${match.id} home`);
      equal(match.goals.filter((goal) => goal.team === match.away).length, match.score.away, `${match.id} away`);
    }
  });

  test('golden match fixtures and goal semantics', () => {
    for (const [label, expected] of Object.entries(facts.matchFixtures)) {
      if (label.startsWith('_') || ['1938-replays', '1950-final-round', '1966-final'].includes(label)) continue;
      const candidates = allMatches.filter((match) => match.year === expected.year && match.home === expected.home && match.away === expected.away);
      equal(candidates.length, 1, `${label} match count`);
      const actual = candidates[0];
      deepEqual(score(actual), expected.score, `${label} score`);
      for (const key of ['aet', 'pens', 'ft90']) if (Object.hasOwn(expected, key)) deepEqual(actual.score[key], expected[key], `${label} ${key}`);
      equal(actual.goals.length, expected.goals.length, `${label} goal count`);
      expected.goals.forEach((goal, index) => {
        const actualGoal = actual.goals[index];
        const player = players[actualGoal.player];
        equal(Boolean(player), true, `${label} goal ${index + 1} player`);
        equal(foldCompact(player.name).includes(foldCompact(goal.familyName)), true, `${label} goal ${index + 1} ${goal.familyName}`);
        const regulationMinute = Number.parseInt(goal.minute, 10);
        const expectedSemantics = {
          team: goal.team,
          playerTeam: goal.playerTeam ?? goal.team,
          ownGoal: goal.ownGoal ?? false,
          penalty: goal.penalty ?? false,
          period: goal.period ?? (regulationMinute <= 45 ? '1h' : regulationMinute <= 90 ? '2h' : regulationMinute <= 105 ? 'et1' : 'et2'),
          minute: goal.minute,
        };
        for (const key of ['team', 'playerTeam', 'ownGoal', 'penalty', 'period', 'minute']) {
          deepEqual(actualGoal[key], expectedSemantics[key], `${label} goal ${index + 1} ${key}`);
        }
      });
    }

    for (const expected of facts.matchFixtures['1938-replays']) {
      const pair = allMatches.filter((match) => match.year === 1938 && match.home === expected.home && match.away === expected.away);
      equal(pair.length, 2, `1938 ${expected.home}-${expected.away}`);
      const first = pair.find((match) => match.replayed);
      const replay = pair.find((match) => match.replay);
      equal(Boolean(first), true, `${expected.home}-${expected.away} replayed`);
      equal(Boolean(replay), true, `${expected.home}-${expected.away} replay`);
      deepEqual(score(first), expected.first, `${expected.home}-${expected.away} first`);
      deepEqual(score(replay), expected.replay, `${expected.home}-${expected.away} replay`);
    }

    const finalRound = details.get(1950).groups.find((group) => group.stage === 'final-round');
    equal(Boolean(finalRound), true, '1950 final round');
    deepEqual(finalRound.standings.map((row) => [row.team, row.pts]), facts.matchFixtures['1950-final-round']);

    const expectedFinal = facts.matchFixtures['1966-final'];
    const final1966 = details.get(1966).matches.find((match) => match.stage === 'final');
    deepEqual({ home: final1966.home, away: final1966.away, score: score(final1966), aet: final1966.score.aet }, {
      home: expectedFinal.home, away: expectedFinal.away, score: expectedFinal.score, aet: expectedFinal.aet,
    });
    const hurst = records.hatTricks.find((item) => item.match === final1966.id
      && foldCompact(players[item.player].name).includes(foldCompact(expectedFinal.hatTrick)));
    equal(Boolean(hurst), true, '1966 final Hurst hat-trick record');
    equal(hurst.goals, 3, '1966 final Hurst goals');
  });

  test('golden records collections', () => {
    for (const [name, collection] of Object.entries(records)) {
      equal(Array.isArray(collection), true, `${name} is an array`);
      equal(collection.length > 0, true, `${name} is non-empty`);
    }
    for (const id of [...records.biggestWins, ...records.highestScoring, ...records.shootouts, ...records.hatTricks.map((item) => item.match)]) {
      equal(matchIndex.has(id), true, `records match ${id}`);
    }
    const describeMatch = (id) => {
      const match = matchIndex.get(id);
      return { year: match.year, home: match.home, away: match.away };
    };
    const asSet = (items) => sorted(items.map((item) => JSON.stringify(item)));
    deepEqual(asSet(records.biggestWins.slice(0, 3).map(describeMatch)), asSet(facts.records.biggestWinsTop3), 'biggest wins margin 9');
    deepEqual(asSet(records.biggestWins.slice(3, 6).map(describeMatch)), asSet(facts.records.biggestWinsNext3Margin8), 'biggest wins margin 8');
    const highest = matchIndex.get(records.highestScoring[0]);
    deepEqual({ ...describeMatch(highest.id), score: score(highest) }, facts.records.highestScoringFirst);
    facts.records.tournamentScorersFirst2.forEach((expected, index) => {
      const actual = records.tournamentScorers[index];
      equal(actual.year, expected.year, `tournament scorer ${index + 1} year`);
      equal(actual.goals, expected.goals, `tournament scorer ${index + 1} goals`);
      if (expected.player) equal(actual.player, expected.player, `tournament scorer ${index + 1} player`);
      if (expected.familyName) equal(foldCompact(players[actual.player].name).includes(foldCompact(expected.familyName)), true, `tournament scorer ${index + 1} family`);
    });
    equal(records.shootouts.length, facts.records.shootoutsTotal, 'shootouts total');
    for (const expected of facts.records.hatTricksInclude) {
      const found = records.hatTricks.find((item) => {
        const match = matchIndex.get(item.match);
        return item.goals === expected.goals
          && (!expected.player || item.player === expected.player)
          && (!expected.familyName || foldCompact(players[item.player].name).includes(foldCompact(expected.familyName)))
          && (!expected.year || match.year === expected.year)
          && (!expected.home || match.home === expected.home)
          && (!expected.away || match.away === expected.away);
      });
      equal(Boolean(found), true, `hat-trick ${expected.player || expected.familyName}`);
    }
  });

  test('golden 2026 player identities', () => {
    const sourceSquads = JSON.parse(readFileSync(join(ROOT, '.cache/sources/openfootball/2026-squads.json'), 'utf8'));
    const tournament = details.get(2026);
    const resolveSquadPlayer = (team, squadName) => {
      const sourceTeam = sourceSquads.find((item) => teams[team].sourceNames.includes(item.name));
      equal(Boolean(sourceTeam), true, `${team} source squad`);
      const sourcePlayers = sourceTeam.players.filter((item) => foldCompact(item.name) === foldCompact(squadName));
      equal(sourcePlayers.length, 1, `${team} ${squadName} source player`);
      const members = tournament.squads[team].filter((item) => item.no === sourcePlayers[0].number);
      equal(members.length, 1, `${team} ${squadName} generated member`);
      return members[0];
    };
    for (const expected of facts.identity2026.mustBeDifferentPeople) {
      const member = resolveSquadPlayer(expected.team, expected.squadName);
      equal(member.player === expected.notLinkedTo, false, `${expected.team} ${expected.squadName}`);
      if (expected.goals2026 !== undefined) {
        const goals = tournament.matches.flatMap((match) => match.goals).filter((goal) => !goal.ownGoal && goal.player === member.player).length;
        equal(goals, expected.goals2026, `${expected.team} ${expected.squadName} 2026 goals`);
      }
    }
    for (const expected of facts.identity2026.mustBeSamePerson) {
      const member = resolveSquadPlayer(expected.team, expected.squadName);
      equal(member.player, expected.linkedTo, `${expected.team} ${expected.squadName}`);
      if (expected.goals2026 !== undefined) {
        const goals = tournament.matches.flatMap((match) => match.goals).filter((goal) => !goal.ownGoal && goal.player === member.player).length;
        equal(goals, expected.goals2026, `${expected.team} ${expected.squadName} 2026 goals`);
      }
    }
  });

  test('no duplicate player within any tournament squad', () => {
    for (const [year, detail] of details) for (const [team, squad] of Object.entries(detail.squads)) {
      equal(new Set(squad.map((item) => item.player)).size, squad.length, `${year} ${team} duplicate player`);
    }
  });

  test('2026 identity decisions reviewed', () => {
    const decisions = JSON.parse(readFileSync(join(ROOT, 'curated/identity-2026.json'), 'utf8'));
    const unreviewed = Object.entries(decisions).filter(([, item]) => !item.reviewed).map(([key]) => key).sort(compare);
    equal(unreviewed.length, 0, `unreviewed: ${unreviewed.join(', ')}`);
  });

  test('team references exist and Japanese ruby is valid', () => {
    const references = [];
    for (const tournament of details.values()) {
      references.push(...tournament.hosts, ...Object.values(tournament.placings).filter(Boolean), ...Object.keys(tournament.squads));
      for (const award of tournament.awards) references.push(award.team);
      for (const group of tournament.groups) for (const row of group.standings) references.push(row.team);
      for (const match of tournament.matches) {
        references.push(match.home, match.away);
        for (const goal of match.goals) references.push(goal.team, goal.playerTeam);
      }
    }
    for (const [key, team] of Object.entries(teams)) {
      references.push(...team.predecessors);
      if (team.successor) references.push(team.successor);
      parseRuby(team.ja);
      equal(key.length > 0, true);
    }
    for (const player of Object.values(players)) references.push(...player.teams);
    for (const row of records.titles) references.push(row.team);
    for (const row of load('search.json').filter((item) => item.type === 'team')) references.push(row.id);
    for (const row of load('matches.json')) references.push(row[4], row[5]);
    equal(references.length > 0, true);
    for (const key of references) equal(Boolean(teams[key]), true, `missing team ${key}`);
    const stageLabels = JSON.parse(readFileSync(join(ROOT, 'curated/stages.json')));
    for (const [key, label] of Object.entries(stageLabels)) {
      if (key === '_byYear') for (const labels of Object.values(label)) Object.values(labels).forEach(parseRuby);
      else parseRuby(label);
    }
  });

  test('2026 group and advancement structure', () => {
    const tournament = details.get(2026);
    equal(tournament.groups.length, 12);
    deepEqual(tournament.groups.map((group) => group.name.replace('Group ', '')).sort(compare), Object.keys(facts.groups2026).filter((key) => !key.startsWith('_')).sort(compare));
    const r32 = new Set(tournament.matches.filter((match) => match.stage === 'r32').flatMap((match) => [match.home, match.away]));
    equal(r32.size, 32);
    let groupMatchCount = 0;
    const expectedAdvanced = new Set();
    for (const group of tournament.groups) {
      equal(group.standings.length, 4, group.name);
      const members = new Set(group.standings.map((row) => row.team));
      const matches = tournament.matches.filter((match) => match.stage === 'group' && match.group === group.name);
      equal(matches.length, 6, group.name);
      for (const match of matches) equal(members.has(match.home) && members.has(match.away), true, group.name);
      groupMatchCount += matches.length;
      const key = group.name.replace('Group ', '');
      deepEqual(group.standings.map((row) => row.team), facts.groups2026[key], `${group.name} order`);
      deepEqual(group.standings.map((row) => row.pos), [1, 2, 3, 4], `${group.name} positions`);
      expectedAdvanced.add(facts.groups2026[key][0]);
      expectedAdvanced.add(facts.groups2026[key][1]);
    }
    equal(groupMatchCount, 72);
    for (const team of facts.thirds2026.ranked.slice(0, facts.thirds2026.advancedCount)) expectedAdvanced.add(team);
    deepEqual(sorted(r32), sorted(expectedAdvanced), 'golden round of 32 field');
    const flagged = new Set(tournament.groups.flatMap((group) => group.standings).filter((row) => row.advanced).map((row) => row.team));
    deepEqual(sorted(flagged), sorted(expectedAdvanced), 'golden advanced flags');
    for (const group of tournament.groups) for (const row of group.standings) {
      equal(row.advanced, expectedAdvanced.has(row.team), `${group.name} ${row.team} advanced`);
    }
  });

  test('stage vocabulary and goal ordering', () => {
    const vocabulary = new Set(['group', 'second-group', 'final-round', 'r32', 'r16', 'qf', 'sf', 'third', 'final']);
    equal(allMatches.length > 0, true);
    for (const match of allMatches) {
      equal(vocabulary.has(match.stage), true, `${match.id} ${match.stage}`);
      for (let index = 1; index < match.goals.length; index += 1) equal(match.goals[index - 1].sort <= match.goals[index].sort, true, match.id);
    }
    for (const tournament of tournaments) for (const stage of tournament.stages) equal(vocabulary.has(stage), true, `${tournament.year} ${stage}`);
  });

  test('determinism and committed output', () => {
    const first = mkdtempSync(join(tmpdir(), 'wcupedia-build-a-'));
    const second = mkdtempSync(join(tmpdir(), 'wcupedia-build-b-'));
    try {
      for (const out of [first, second]) execFileSync(process.execPath, [join(ROOT, 'tools/build-data.mjs'), '--src', join(ROOT, '.cache/sources'), '--out', out], { cwd: ROOT, stdio: 'pipe' });
      const expectedFiles = recursiveFiles(DATA);
      equal(expectedFiles.length > 0, true);
      deepEqual(recursiveFiles(first), expectedFiles);
      deepEqual(recursiveFiles(second), expectedFiles);
      const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
      for (const file of expectedFiles) {
        const committed = hash(join(DATA, file));
        equal(hash(join(first, file)), committed, `${file} first`);
        equal(hash(join(second, file)), committed, `${file} second`);
      }
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  test('generated output has no path leakage', () => {
    const files = recursiveFiles(DATA);
    equal(files.length > 0, true);
    for (const file of files) {
      const content = readFileSync(join(DATA, file), 'utf8');
      for (const forbidden of ['/Users/', '/home/', '/private/', '.cache']) equal(content.includes(forbidden), false, `${file} contains ${forbidden}`);
      equal(/[A-Za-z]:\\\\[^"\n]+/.test(content), false, `${file} contains a backslash path`);
    }
  });
}
