#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './lib/csv.mjs';
import { SOURCES } from './lib/sources.mjs';
import { conductScore, rankGroup2026 } from './lib/standings-2026.mjs';
import { chooseJapaneseNames, matchSquadClubEntry, matchSquadEntry, parseSquadWikitext, validateJapaneseName } from './lib/players-ja.mjs';
import { applySquadChanges, playerTieOrder, rankRows, resolveLineups2026 } from './lib/phase4.mjs';
import { addTournamentHostKeys, mergeSearchAliases } from './lib/search-data.mjs';
import { validatePhotoManifest, validatePhotoOriginals } from './lib/photos.mjs';
import { fold, foldCompact } from '../public/js/fold.js';
import { playerLabel } from '../public/js/format.js';
import { rubyPlain, rubyReading, parseRuby } from '../public/js/ruby.js';
import { ageInDays, ageInYears, isIsoDate } from '../public/js/ages.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
let sourceRoot = '.cache/sources';
let outputRoot = 'public/data';
let searchAliasesPath = join(ROOT, 'curated/search-aliases.json');
let birthDateCorrectionsPath = join(ROOT, 'curated/birth-date-corrections.json');
let photosPath = join(ROOT, 'curated/photos.json');
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--src' && args[index + 1]) sourceRoot = args[++index];
  else if (args[index] === '--out' && args[index + 1]) outputRoot = args[++index];
  else if (args[index] === '--search-aliases' && args[index + 1]) searchAliasesPath = resolve(args[++index]);
  else if (args[index] === '--birth-date-corrections' && args[index + 1]) birthDateCorrectionsPath = resolve(args[++index]);
  else if (args[index] === '--photos' && args[index + 1]) photosPath = resolve(args[++index]);
  else throw new Error('usage: node tools/build-data.mjs [--src DIR] [--out DIR] [--search-aliases FILE] [--birth-date-corrections FILE] [--photos FILE]');
}
sourceRoot = resolve(sourceRoot);
outputRoot = resolve(outputRoot);

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const number = (value) => Number(value);
const unique = (items) => [...new Set(items)];
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const csv = async (name) => parseCsv(await readFile(join(sourceRoot, 'fjelstul', name), 'utf8'));
const isMen = (row) => row.tournament_name.includes("Men's");
const yearOf = (row) => number(row.tournament_id.slice(3));
const sortById = (items) => items.sort((a, b) => compare(a.id, b.id));

const curatedTeams = await json(join(ROOT, 'curated/teams.json'));
const stagesJa = await json(join(ROOT, 'curated/stages.json'));
const aliases2026 = await json(join(ROOT, 'curated/name-aliases-2026.json'));
const identity2026 = await json(join(ROOT, 'curated/identity-2026.json'));
const tournament2026 = await json(join(ROOT, 'curated/tournament-2026.json'));
const squadChanges2026 = await json(join(ROOT, 'curated/squad-changes-2026.json'));
const confederationFallbacks = await json(join(ROOT, 'curated/confederations.json'));
const teamHeadingsJa = await json(join(ROOT, 'curated/team-headings-ja.json'));
const playersJaOverrides = await json(join(ROOT, 'curated/players-ja-overrides.json'));
const searchAliases = await json(searchAliasesPath);
const birthDateCorrections = await json(birthDateCorrectionsPath);
const photoManifest = await json(photosPath);
const photoEntries = validatePhotoManifest(photoManifest);
await validatePhotoOriginals(photoEntries, join(sourceRoot, 'photos/orig'));
const photoIds = new Set(photoEntries.map(([id]) => id));
const playerJaTitles = await json(join(sourceRoot, 'wikipedia/player-ja-titles.json'));
let standingsOverrides2026 = {};
try {
  standingsOverrides2026 = await json(join(ROOT, 'curated/standings-2026-overrides.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const team of Object.values(curatedTeams)) parseRuby(team.ja);
for (const [key, label] of Object.entries(stagesJa)) {
  if (key === '_byYear') for (const labels of Object.values(label)) Object.values(labels).forEach(parseRuby);
  else parseRuby(label);
}

const teamIdToKey = new Map();
const teamNameToKey = new Map();
for (const key of Object.keys(curatedTeams).sort(compare)) {
  const team = curatedTeams[key];
  if (team.fjelstulTeamId) {
    if (teamIdToKey.has(team.fjelstulTeamId)) throw new Error(`duplicate Fjelstul team id ${team.fjelstulTeamId}`);
    teamIdToKey.set(team.fjelstulTeamId, key);
  }
  for (const name of team.sourceNames) {
    if (teamNameToKey.has(name) && teamNameToKey.get(name) !== key) throw new Error(`ambiguous team source name ${name}`);
    teamNameToKey.set(name, key);
  }
}
const keyForTeamId = (id) => {
  const key = teamIdToKey.get(id);
  if (!key) throw new Error(`unmapped Fjelstul team id ${id}`);
  return key;
};
const keyForTeamName = (name) => {
  const key = teamNameToKey.get(name);
  if (!key) throw new Error(`unmapped openfootball team name ${JSON.stringify(name)}`);
  return key;
};

const [
  tournamentsRows, matchesRows, goalsRows, groupRows, hostRows, playerRows, teamRows,
  squadRows, qualifiedRows, standingRows, stageRows, awardRows, appearanceRows,
] = await Promise.all([
  csv('tournaments.csv'), csv('matches.csv'), csv('goals.csv'), csv('group_standings.csv'),
  csv('host_countries.csv'), csv('players.csv'), csv('teams.csv'), csv('squads.csv'), csv('qualified_teams.csv'),
  csv('tournament_standings.csv'), csv('tournament_stages.csv'), csv('award_winners.csv'), csv('player_appearances.csv'),
]);
const menTournaments = tournamentsRows.filter(isMen).sort((a, b) => number(a.year) - number(b.year));
const menIds = new Set(menTournaments.map((row) => row.tournament_id));
const menMatches = matchesRows.filter((row) => menIds.has(row.tournament_id));
const menGoals = goalsRows.filter((row) => menIds.has(row.tournament_id));
const menGroups = groupRows.filter((row) => menIds.has(row.tournament_id));
const menHosts = hostRows.filter((row) => menIds.has(row.tournament_id));
const menSquads = squadRows.filter((row) => menIds.has(row.tournament_id));
const menQualified = qualifiedRows.filter((row) => menIds.has(row.tournament_id));
const menStandings = standingRows.filter((row) => menIds.has(row.tournament_id));
const menStages = stageRows.filter((row) => menIds.has(row.tournament_id));
const menAwards = awardRows.filter((row) => menIds.has(row.tournament_id));
const menAppearances = appearanceRows.filter((row) => menIds.has(row.tournament_id));
for (const row of teamRows.filter((team) => team.mens_team === '1' && teamIdToKey.has(team.team_id))) {
  const key = keyForTeamId(row.team_id);
  const expectedKey = row.team_id === 'T-86' ? 'FRG' : row.team_id === 'T-88' ? 'ZAI' : row.team_code;
  if (key !== expectedKey) throw new Error(`curated key ${key} does not match ${row.team_id} expected ${expectedKey}`);
  if (!curatedTeams[key].sourceNames.includes(row.team_name)) throw new Error(`${key} lacks Fjelstul source name ${row.team_name}`);
}

const stageKey = (name) => ({
  'first round': 'group',
  'first group stage': 'group',
  'group stage': 'group',
  'second group stage': 'second-group',
  'final round': 'final-round',
  'round of 16': 'r16',
  'quarter-finals': 'qf',
  'semi-finals': 'sf',
  'third-place match': 'third',
  final: 'final',
}[name] || (() => { throw new Error(`unknown Fjelstul stage ${name}`); })());
const awardKey = (name) => ({
  'Golden Ball': 'golden-ball', 'Silver Ball': 'silver-ball', 'Bronze Ball': 'bronze-ball',
  'Golden Boot': 'golden-boot', 'Silver Boot': 'silver-boot', 'Bronze Boot': 'bronze-boot',
  'Golden Glove': 'golden-glove', 'Best Young Player': 'best-young-player',
}[name] || (() => { throw new Error(`unknown award ${name}`); })());
const periodKey = (name) => {
  if (name.startsWith('first half')) return '1h';
  if (name.startsWith('second half')) return '2h';
  if (name.startsWith('extra time, first half')) return 'et1';
  if (name.startsWith('extra time, second half')) return 'et2';
  throw new Error(`unknown match period ${name}`);
};
const displayName = (row) => row.given_name === 'not applicable'
  ? row.family_name : `${row.given_name} ${row.family_name}`;

const playerSource = new Map(playerRows.map((row) => [row.player_id, row]));
const birthDates = new Map(playerRows.map((row) => [row.player_id, row.birth_date === 'not available' ? null : row.birth_date]));
for (const [id, correction] of Object.entries(birthDateCorrections)) {
  if (id === '_about') continue;
  if (!playerSource.has(id)) throw new Error(`birth-date correction has unknown player ${id}`);
  if (!correction || !isIsoDate(correction.birthDate) || typeof correction.source !== 'string' || !correction.source.trim()) {
    throw new Error(`invalid birth-date correction ${id}`);
  }
  if (birthDates.get(id) === correction.birthDate) throw new Error(`birth-date correction equals source value for ${id}`);
  birthDates.set(id, correction.birthDate);
}
const playerData = new Map();
const ensurePlayer = (id) => {
  if (!playerData.has(id)) {
    const row = playerSource.get(id);
    if (!row) throw new Error(`missing Fjelstul player ${id}`);
    playerData.set(id, {
      name: displayName(row), ja: null, teams: new Set(), years: new Set(),
      goals: 0, goalsByYear: {}, awards: [], appsByYear: {}, birthDate: birthDates.get(id),
    });
  }
  return playerData.get(id);
};
for (const row of menSquads) {
  const player = ensurePlayer(row.player_id);
  const team = keyForTeamId(row.team_id);
  player.teams.add(team);
  player.years.add(yearOf(row));
  if (team === 'KOR') {
    const source = playerSource.get(row.player_id);
    if (source.given_name !== 'not applicable') player.name = `${source.family_name} ${source.given_name}`;
  }
}
for (const row of menAppearances) {
  const player = ensurePlayer(row.player_id);
  const year = yearOf(row);
  player.appsByYear[year] = (player.appsByYear[year] || 0) + 1;
}
for (const row of menAwards) ensurePlayer(row.player_id).awards.push([yearOf(row), awardKey(row.award_name)]);

const normalizeMinute = (label) => label.replaceAll("'", '').trim();
const matchesByYear = new Map();
for (const row of menMatches) {
  const year = yearOf(row);
  const goals = menGoals.filter((goal) => goal.match_id === row.match_id).map((goal) => {
    const player = ensurePlayer(goal.player_id);
    const ownGoal = goal.own_goal === '1';
    if (!ownGoal) {
      player.goals += 1;
      player.goalsByYear[year] = (player.goalsByYear[year] || 0) + 1;
    }
    return {
      player: goal.player_id,
      team: keyForTeamId(goal.team_id),
      playerTeam: keyForTeamId(goal.player_team_id),
      ownGoal,
      penalty: goal.penalty === '1',
      minute: normalizeMinute(goal.minute_label),
      sort: number(goal.minute_regulation) * 100 + number(goal.minute_stoppage),
      period: periodKey(goal.match_period),
    };
  }).sort((a, b) => a.sort - b.sort || compare(a.player, b.player));
  const match = {
    id: row.match_id,
    date: row.match_date,
    time: row.match_time === 'not applicable' ? null : row.match_time,
    stage: stageKey(row.stage_name),
    group: row.group_name === 'not applicable' ? null : row.group_name,
    home: keyForTeamId(row.home_team_id),
    away: keyForTeamId(row.away_team_id),
    score: {
      home: number(row.home_team_score), away: number(row.away_team_score),
      aet: row.extra_time === '1',
      pens: row.penalty_shootout === '1' ? [number(row.home_team_score_penalties), number(row.away_team_score_penalties)] : null,
      ft90: row.extra_time === '1' ? [
        goals.filter((goal) => goal.team === keyForTeamId(row.home_team_id) && (goal.period === '1h' || goal.period === '2h')).length,
        goals.filter((goal) => goal.team === keyForTeamId(row.away_team_id) && (goal.period === '1h' || goal.period === '2h')).length,
      ] : null,
      ht: [
        goals.filter((goal) => goal.team === keyForTeamId(row.home_team_id) && goal.period === '1h').length,
        goals.filter((goal) => goal.team === keyForTeamId(row.away_team_id) && goal.period === '1h').length,
      ],
    },
    replay: row.replay === '1', replayed: row.replayed === '1',
    venue: row.stadium_name === 'not applicable' ? null : { stadium: row.stadium_name, city: row.city_name },
    goals,
  };
  if (!matchesByYear.has(year)) matchesByYear.set(year, []);
  matchesByYear.get(year).push(match);
}
for (const matches of matchesByYear.values()) matches.sort((a, b) => compare(a.date, b.date) || compare(a.time || '', b.time || '') || compare(a.id, b.id));

const groupsByYear = new Map();
for (const row of menGroups) {
  const year = yearOf(row);
  const key = `${stageKey(row.stage_name)}\0${row.group_name}`;
  if (!groupsByYear.has(year)) groupsByYear.set(year, new Map());
  const groups = groupsByYear.get(year);
  if (!groups.has(key)) groups.set(key, { stage: stageKey(row.stage_name), name: row.group_name, standings: [] });
  groups.get(key).standings.push({
    team: keyForTeamId(row.team_id), pos: number(row.position), p: number(row.played),
    w: number(row.wins), d: number(row.draws), l: number(row.losses), gf: number(row.goals_for),
    ga: number(row.goals_against), gd: number(row.goal_difference), pts: number(row.points), advanced: row.advanced === '1',
  });
}
for (const groups of groupsByYear.values()) for (const group of groups.values()) group.standings.sort((a, b) => a.pos - b.pos);

const full2026 = await json(join(sourceRoot, 'openfootball/2026-full.json'));
const squads2026Source = await json(join(sourceRoot, 'openfootball/2026-squads.json'));
const groups2026Source = await json(join(sourceRoot, 'openfootball/2026-groups.json'));
const teams2026Source = await json(join(sourceRoot, 'openfootball/2026-teams.json'));
for (const team of squads2026Source) keyForTeamName(team.name);
for (const team of teams2026Source) {
  keyForTeamName(team.name);
  if (team.name_normalised) keyForTeamName(team.name_normalised);
}
for (const group of groups2026Source.groups) for (const name of group.teams) keyForTeamName(name);
for (const match of full2026.matches) { keyForTeamName(match.team1); keyForTeamName(match.team2); }

let roster2026 = [];
for (const team of squads2026Source) {
  const teamKey = keyForTeamName(team.name);
  for (const sourcePlayer of team.players) roster2026.push({ ...sourcePlayer, team: teamKey });
}
roster2026 = applySquadChanges(roster2026, squadChanges2026.changes);
for (const player of roster2026) if (!isIsoDate(player.date_of_birth)) {
  throw new Error(`invalid 2026 birth date ${player.team} ${player.name}: ${player.date_of_birth}`);
}
roster2026.sort((a, b) => compare(a.team, b.team) || compare(foldCompact(a.name), foldCompact(b.name)) || compare(a.name, b.name));
const rosterByTeam = new Map();
for (const player of roster2026) {
  if (!rosterByTeam.has(player.team)) rosterByTeam.set(player.team, []);
  rosterByTeam.get(player.team).push(player);
}
const fjelstulByTeamBirth = new Map();
for (const [id, player] of playerData) {
  for (const team of player.teams) {
    const key = `${team}\0${player.birthDate}`;
    if (!fjelstulByTeamBirth.has(key)) fjelstulByTeamBirth.set(key, []);
    fjelstulByTeamBirth.get(key).push(id);
  }
}
for (const [key, decision] of Object.entries(identity2026)) {
  if (!key.includes('|') || !decision || (decision.fjelstulId !== null && !/^P-\d+$/.test(decision.fjelstulId))
    || typeof decision.reviewed !== 'boolean' || typeof decision.reason !== 'string' || !decision.reason.trim()) {
    throw new Error(`invalid 2026 identity decision ${key}`);
  }
}
const nameTokens = (value) => fold(value).split(' ').filter(Boolean);
const agreesByName = (rosterPlayer, candidateId) => {
  const candidate = playerSource.get(candidateId);
  const squadName = foldCompact(rosterPlayer.name);
  // Deterministic rule: the folded Fjelstul family name must occur in the
  // folded squad name. Unless the given name is unavailable, one of its tokens
  // must also share its first three folded letters with a squad-name token;
  // token order is irrelevant (notably for Korean family-name-first entries).
  if (!squadName.includes(foldCompact(candidate.family_name))) return false;
  if (candidate.given_name === 'not applicable') return true;
  const squadTokens = nameTokens(rosterPlayer.name);
  return nameTokens(candidate.given_name).some((given) =>
    squadTokens.some((token) => given.slice(0, 3) === token.slice(0, 3)));
};
const identityFailures = [];
const usedIdentityDecisions = new Set();
const resolved2026Ids = new Map();
for (const rosterPlayer of roster2026) {
  const key = `${rosterPlayer.team}|${rosterPlayer.name}`;
  const birthCandidates = fjelstulByTeamBirth.get(`${rosterPlayer.team}\0${rosterPlayer.date_of_birth}`) || [];
  const passing = birthCandidates.filter((id) => agreesByName(rosterPlayer, id));
  const failing = birthCandidates.filter((id) => !agreesByName(rosterPlayer, id));
  let candidates = passing;
  if (failing.length) {
    const decision = identity2026[key];
    if (!decision) {
      identityFailures.push(`${key} ${rosterPlayer.date_of_birth}: ${failing.map((id) => `${id} ${displayName(playerSource.get(id))}`).join(', ')}`);
      continue;
    }
    usedIdentityDecisions.add(key);
    if (decision.fjelstulId !== null && !birthCandidates.includes(decision.fjelstulId)) {
      throw new Error(`2026 identity decision ${key} selects ${decision.fjelstulId}, which is not a same-team, same-DOB candidate`);
    }
    candidates = decision.fjelstulId === null ? [] : [decision.fjelstulId];
  }
  if (candidates.length > 1) {
    identityFailures.push(`${key} ${rosterPlayer.date_of_birth}: ambiguous name agreement ${candidates.join(', ')}`);
    continue;
  }
  resolved2026Ids.set(rosterPlayer, candidates[0] || null);
}
for (const key of Object.keys(identity2026)) if (!usedIdentityDecisions.has(key)) identityFailures.push(`${key}: decision has no name-rule failure in the pinned inputs`);
if (identityFailures.length) throw new Error(`unresolved 2026 identity decisions:\n${identityFailures.sort(compare).join('\n')}`);
let linked2026 = 0;
const generated2026Ids = new Map();
for (const rosterPlayer of roster2026) {
  const linkedId = resolved2026Ids.get(rosterPlayer);
  if (linkedId) {
    rosterPlayer.id = linkedId;
    linked2026 += 1;
  } else {
    const identity = `${rosterPlayer.team}|${rosterPlayer.date_of_birth}|${foldCompact(rosterPlayer.name)}`;
    rosterPlayer.id = `P26-${createHash('sha256').update(identity).digest('hex').slice(0, 10)}`;
    if (generated2026Ids.has(rosterPlayer.id)) {
      throw new Error(`2026 player id collision ${rosterPlayer.id}: ${generated2026Ids.get(rosterPlayer.id)} and ${identity}`);
    }
    generated2026Ids.set(rosterPlayer.id, identity);
    playerData.set(rosterPlayer.id, {
      name: rosterPlayer.name, ja: null, teams: new Set(), years: new Set(), goals: 0, goalsByYear: {}, awards: [], appsByYear: {}, birthDate: rosterPlayer.date_of_birth,
    });
  }
  const player = playerData.get(rosterPlayer.id);
  player.teams.add(rosterPlayer.team);
  player.years.add(2026);
}

const rosterLookup = new Map();
for (const [team, roster] of rosterByTeam) {
  const lookup = new Map();
  for (const player of roster) {
    const key = foldCompact(player.name);
    if (lookup.has(key)) throw new Error(`duplicate folded roster name for ${team}: ${player.name}`);
    lookup.set(key, player);
  }
  rosterLookup.set(team, lookup);
}
const unresolved = new Set();
const resolve2026Player = (sourceName, team) => {
  const aliasName = aliases2026[team]?.[sourceName] || sourceName;
  const player = rosterLookup.get(team)?.get(foldCompact(aliasName));
  if (!player) {
    unresolved.add(`${team}: ${sourceName}`);
    return null;
  }
  return player;
};
for (const match of full2026.matches) {
  const home = keyForTeamName(match.team1);
  const away = keyForTeamName(match.team2);
  for (const goal of match.goals1 || []) resolve2026Player(goal.name, goal.owngoal ? away : home);
  for (const goal of match.goals2 || []) resolve2026Player(goal.name, goal.owngoal ? home : away);
}
for (const item of tournament2026.awards) resolve2026Player(item.player.name, item.player.team);
const apps2026 = resolveLineups2026(full2026.matches, keyForTeamName, resolve2026Player);
if (unresolved.size) throw new Error(`unresolved 2026 player names:\n${[...unresolved].sort(compare).join('\n')}`);

for (const [id, apps] of apps2026) playerData.get(id).appsByYear[2026] = apps;

const utcKickoff = (match) => {
  const parsed = /^(\d{2}):(\d{2}) UTC([+-])(\d{1,2})$/.exec(match.time);
  if (!parsed) throw new Error(`invalid kickoff time ${match.time}`);
  const [, hour, minute, sign, offsetText] = parsed;
  const offset = number(offsetText) * (sign === '+' ? 1 : -1);
  return `${match.date}T${String(number(hour) - offset + 24).padStart(2, '0')}:${minute}`;
};
const ordered2026 = full2026.matches.map((match, sourceIndex) => ({ match, sourceIndex }))
  .sort((a, b) => compare(a.match.date, b.match.date) || compare(utcKickoff(a.match), utcKickoff(b.match)) || a.sourceIndex - b.sourceIndex);
const stage2026 = (round) => {
  if (round.startsWith('First Stage, ')) return 'group';
  return ({ 'Round of 32': 'r32', 'Round of 16': 'r16', 'Quarter-final': 'qf', 'Semi-final': 'sf', 'Bronze final': 'third', Final: 'final' })[round]
    || (() => { throw new Error(`unknown 2026 stage ${round}`); })();
};
const openScore = (score) => score.et || score.ft;
const goalTime = (label) => {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(label);
  if (!match) throw new Error(`invalid goal minute ${label}`);
  return { regulation: number(match[1]), stoppage: number(match[2] || 0) };
};
const openPeriod = (regulation) => regulation <= 45 ? '1h' : regulation <= 90 ? '2h' : regulation <= 105 ? 'et1' : 'et2';
const matches2026 = [];
const rankingMatches2026 = [];
for (let index = 0; index < ordered2026.length; index += 1) {
  const sourceMatch = ordered2026[index].match;
  const home = keyForTeamName(sourceMatch.team1);
  const away = keyForTeamName(sourceMatch.team2);
  const convertGoals = (sourceGoals, creditedTeam, opponent) => sourceGoals.map((goal) => {
    const playerTeam = goal.owngoal ? opponent : creditedTeam;
    const rosterPlayer = resolve2026Player(goal.name, playerTeam);
    const time = goalTime(goal.minute);
    const player = playerData.get(rosterPlayer.id);
    if (!goal.owngoal) {
      player.goals += 1;
      player.goalsByYear[2026] = (player.goalsByYear[2026] || 0) + 1;
    }
    return {
      player: rosterPlayer.id, team: creditedTeam, playerTeam,
      ownGoal: Boolean(goal.owngoal), penalty: Boolean(goal.penalty), minute: goal.minute,
      sort: time.regulation * 100 + time.stoppage, period: openPeriod(time.regulation),
    };
  });
  const goals = [...convertGoals(sourceMatch.goals1 || [], home, away), ...convertGoals(sourceMatch.goals2 || [], away, home)]
    .sort((a, b) => a.sort - b.sort || compare(a.player, b.player));
  const result = openScore(sourceMatch.score);
  const bookingSides = sourceMatch.bookings == null ? [[], []] : sourceMatch.bookings;
  if (!Array.isArray(bookingSides) || bookingSides.length !== 2) throw new Error(`invalid 2026 bookings for match ${index + 1}`);
  conductScore(bookingSides[0]);
  conductScore(bookingSides[1]);
  rankingMatches2026.push({
    home, away, group: sourceMatch.round.startsWith('First Stage, ') ? sourceMatch.round.slice('First Stage, '.length) : null,
    score: { home: result[0], away: result[1] }, bookings: { home: bookingSides[0], away: bookingSides[1] },
  });
  const comma = sourceMatch.ground.indexOf(',');
  matches2026.push({
    id: `M-2026-${String(index + 1).padStart(3, '0')}`,
    date: sourceMatch.date, time: sourceMatch.time,
    stage: stage2026(sourceMatch.round),
    group: sourceMatch.round.startsWith('First Stage, ') ? sourceMatch.round.slice('First Stage, '.length) : null,
    home, away,
    score: {
      home: result[0], away: result[1], aet: Boolean(sourceMatch.score.et),
      pens: sourceMatch.score.p || null, ft90: sourceMatch.score.et ? sourceMatch.score.ft : null,
      ht: sourceMatch.score.ht || null,
    },
    replay: false, replayed: false,
    venue: { stadium: sourceMatch.ground.slice(0, comma), city: sourceMatch.ground.slice(comma + 1).trim() },
    goals,
  });
}
matchesByYear.set(2026, matches2026);

const r32Teams = new Set(matches2026.filter((match) => match.stage === 'r32').flatMap((match) => [match.home, match.away]));
const groups2026 = [];
for (const sourceGroup of groups2026Source.groups) {
  const teamKeys = sourceGroup.teams.map(keyForTeamName);
  const matches = rankingMatches2026.filter((match) => match.group === sourceGroup.name);
  const standings = rankGroup2026(teamKeys, matches, { groupName: sourceGroup.name, override: standingsOverrides2026[sourceGroup.name] });
  groups2026.push({
    stage: 'group', name: sourceGroup.name,
    standings: standings.map(({ conduct, ...row }, index) => ({ ...row, pos: index + 1, advanced: r32Teams.has(row.team) })),
  });
}
groups2026.sort((a, b) => compare(a.name, b.name));

const tournamentDetails = [];
const tournamentSummaries = [];
const finishByTeamYear = new Map();
const stageRank = { group: 0, 'final-round': 1, 'second-group': 2, r32: 3, r16: 4, qf: 5, sf: 6, third: 7, final: 8 };
const setFinish = (team, year, finish) => finishByTeamYear.set(`${team}\0${year}`, finish);
for (const row of menTournaments) {
  const year = number(row.year);
  const matches = matchesByYear.get(year) || [];
  const placings = { '1': null, '2': null, '3': null, '4': null };
  for (const standing of menStandings.filter((item) => item.tournament_id === row.tournament_id && number(item.position) <= 4)) {
    placings[standing.position] = keyForTeamId(standing.team_id);
  }
  const stages = menStages.filter((item) => item.tournament_id === row.tournament_id)
    .sort((a, b) => number(a.stage_number) - number(b.stage_number)).map((item) => stageKey(item.stage_name));
  const goalsByPlayer = new Map();
  for (const goal of matches.flatMap((match) => match.goals).filter((goal) => !goal.ownGoal)) goalsByPlayer.set(goal.player, (goalsByPlayer.get(goal.player) || 0) + 1);
  const maxGoals = Math.max(...goalsByPlayer.values());
  const topScorers = [...goalsByPlayer].filter(([, goals]) => goals === maxGoals).map(([player, goals]) => ({ player, goals })).sort((a, b) => compare(a.player, b.player));
  const awards = menAwards.filter((item) => item.tournament_id === row.tournament_id).map((item) => ({ award: awardKey(item.award_name), player: item.player_id, team: keyForTeamId(item.team_id) }))
    .sort((a, b) => compare(a.award, b.award) || compare(a.player, b.player));
  const hostOrder = row.host_country.split(',').map((name) => keyForTeamName(name.trim()));
  const hosts = menHosts.filter((item) => item.tournament_id === row.tournament_id).map((item) => keyForTeamId(item.team_id))
    .sort((a, b) => hostOrder.indexOf(a) - hostOrder.indexOf(b));
  if (hosts.length !== hostOrder.length || hosts.some((host, index) => host !== hostOrder[index])) throw new Error(`host source disagreement in ${year}`);
  const summary = {
    year, hosts,
    start: row.start_date, end: row.end_date, teams: number(row.count_teams), matches: matches.length,
    goals: matches.reduce((sum, match) => sum + match.score.home + match.score.away, 0),
    placings, stages, topScorers, awards,
  };
  tournamentSummaries.push(summary);
  const groups = [...(groupsByYear.get(year)?.values() || [])].sort((a, b) => stageRank[a.stage] - stageRank[b.stage] || compare(a.name, b.name));
  const squads = {};
  for (const item of menSquads.filter((squad) => squad.tournament_id === row.tournament_id).sort((a, b) => compare(keyForTeamId(a.team_id), keyForTeamId(b.team_id)) || number(a.shirt_number) - number(b.shirt_number) || compare(a.player_id, b.player_id))) {
    const key = keyForTeamId(item.team_id);
    if (!squads[key]) squads[key] = [];
    const shirt = /^\d+$/.test(item.shirt_number) && number(item.shirt_number) > 0 ? number(item.shirt_number) : null;
    squads[key].push({ player: item.player_id, no: shirt, pos: item.position_code });
  }
  tournamentDetails.push({ ...summary, groups, matches, squads });
  for (const item of menQualified.filter((qualified) => qualified.tournament_id === row.tournament_id)) {
    const team = keyForTeamId(item.team_id);
    let finish = ({ 'group stage': 'group', 'second group stage': 'second-group', 'final round': 'final-round', 'round of 16': 'r16', 'quarter-finals': 'qf', 'semi-finals': 'sf' })[item.performance];
    if (placings['1'] === team) finish = 'champion';
    else if (placings['2'] === team) finish = 'runner-up';
    else if (placings['3'] === team) finish = 'third';
    else if (placings['4'] === team) finish = 'fourth';
    if (!finish) throw new Error(`cannot map finish ${year} ${team} ${item.performance}`);
    setFinish(team, year, finish);
  }
}

const final2026 = matches2026.find((match) => match.stage === 'final');
const third2026 = matches2026.find((match) => match.stage === 'third');
const winner = (match) => {
  if (match.score.pens) return match.score.pens[0] > match.score.pens[1] ? match.home : match.away;
  return match.score.home > match.score.away ? match.home : match.away;
};
const loser = (match) => winner(match) === match.home ? match.away : match.home;
const placings2026 = { '1': winner(final2026), '2': loser(final2026), '3': winner(third2026), '4': loser(third2026) };
const goalsByPlayer2026 = new Map();
for (const goal of matches2026.flatMap((match) => match.goals).filter((goal) => !goal.ownGoal)) goalsByPlayer2026.set(goal.player, (goalsByPlayer2026.get(goal.player) || 0) + 1);
const max2026 = Math.max(...goalsByPlayer2026.values());
const topScorers2026 = [...goalsByPlayer2026].filter(([, goals]) => goals === max2026).map(([player, goals]) => ({ player, goals })).sort((a, b) => compare(a.player, b.player));
const awards2026 = tournament2026.awards.map((item) => {
  const player = resolve2026Player(item.player.name, item.player.team);
  return { award: item.award, player: player.id, team: item.player.team };
}).sort((a, b) => compare(a.award, b.award));
for (const award of awards2026) playerData.get(award.player).awards.push([2026, award.award]);
const dates2026 = matches2026.map((match) => match.date).sort(compare);
const summary2026 = {
  year: 2026, hosts: tournament2026.hosts, start: dates2026[0], end: dates2026.at(-1), teams: rosterByTeam.size,
  matches: matches2026.length, goals: matches2026.reduce((sum, match) => sum + match.score.home + match.score.away, 0),
  placings: placings2026, stages: ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'], topScorers: topScorers2026, awards: awards2026,
};
tournamentSummaries.push(summary2026);
const squads2026 = {};
for (const team of [...rosterByTeam.keys()].sort(compare)) squads2026[team] = rosterByTeam.get(team)
  .slice().sort((a, b) => a.number - b.number || compare(a.id, b.id)).map((player) => ({ player: player.id, no: player.number, pos: player.pos }));
tournamentDetails.push({ ...summary2026, groups: groups2026, matches: matches2026, squads: squads2026 });
for (const team of rosterByTeam.keys()) {
  const reached = matches2026.filter((match) => match.home === team || match.away === team).map((match) => match.stage).sort((a, b) => stageRank[b] - stageRank[a])[0];
  let finish = reached;
  if (placings2026['1'] === team) finish = 'champion';
  else if (placings2026['2'] === team) finish = 'runner-up';
  else if (placings2026['3'] === team) finish = 'third';
  else if (placings2026['4'] === team) finish = 'fourth';
  else if (reached === 'third') finish = 'sf';
  setFinish(team, 2026, finish);
}
tournamentSummaries.sort((a, b) => a.year - b.year);
tournamentDetails.sort((a, b) => a.year - b.year);

for (const tournament of tournamentDetails) for (const [team, squad] of Object.entries(tournament.squads)) {
  const seen = new Set();
  for (const member of squad) {
    if (seen.has(member.player)) throw new Error(`duplicate player ${member.player} in ${tournament.year} ${team} squad`);
    seen.add(member.player);
  }
}

const ageGuardOffenders = [];
for (const tournament of tournamentDetails) for (const [team, squad] of Object.entries(tournament.squads)) {
  for (const member of squad) {
    const birthDate = playerData.get(member.player)?.birthDate;
    if (!birthDate) continue;
    const age = ageInYears(birthDate, tournament.start);
    if (age < 15 || age > 46) ageGuardOffenders.push(`${tournament.year} ${team} ${member.player} ${birthDate}: ${age}`);
  }
}
if (ageGuardOffenders.length) throw new Error(`squad age outside 15..46:\n${ageGuardOffenders.sort(compare).join('\n')}`);

for (const [heading, team] of Object.entries(teamHeadingsJa)) {
  if (!curatedTeams[team]) throw new Error(`team heading ${JSON.stringify(heading)} maps to unknown team ${team}`);
}
for (const id of Object.keys(playersJaOverrides)) {
  if (!playerData.has(id)) throw new Error(`Japanese player-name override has unknown player ${id}`);
}

const squadPageYears = [1950, 1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026];
const japaneseSquadMatches = [];
const squadMatchProblems = [];
for (const year of squadPageYears) {
  const tournament = tournamentDetails.find((item) => item.year === year);
  const wikitext = await readFile(join(sourceRoot, `wikipedia/squads/squads-${year}.wiki`), 'utf8');
  const entries = parseSquadWikitext(wikitext, year, teamHeadingsJa);
  for (const entry of entries) {
    const candidates = (tournament.squads[entry.team] || []).map((member) => ({
      id: member.player, no: member.no || null, birthDate: playerData.get(member.player)?.birthDate || null,
      name: playerData.get(member.player)?.name || null,
    }));
    const matched = matchSquadEntry(entry, candidates);
    const clubMatched = matchSquadClubEntry(entry, candidates);
    if (clubMatched.id && entry.club) {
      const member = tournament.squads[entry.team].find((item) => item.player === clubMatched.id);
      if (!member) throw new Error(`matched Japanese squad player missing from ${year} ${entry.team}: ${clubMatched.id}`);
      if (member.club && member.club !== entry.club) {
        throw new Error(`conflicting clubs for ${year} ${entry.team} ${clubMatched.id}: ${member.club} / ${entry.club}`);
      }
      member.club = entry.club;
    }
    if (!matched.id) {
      squadMatchProblems.push({ ...entry, reason: matched.reason });
      continue;
    }
    japaneseSquadMatches.push({ ...entry, id: matched.id });
  }
}

const playersForJapaneseNames = [...playerData].map(([id, player]) => ({
  id, name: player.name, birthDate: player.birthDate,
  team: player.teams.has('JPN') ? 'JPN' : [...player.teams].sort(compare)[0],
}));
const japaneseNames = chooseJapaneseNames({
  players: playersForJapaneseNames, matches: japaneseSquadMatches,
  articleTitles: playerJaTitles, overrides: playersJaOverrides,
});
for (const [id, choice] of japaneseNames.chosen) {
  const player = playerData.get(id);
  player.ja = choice.ja;
  player.reading = choice.reading;
  player.jaSource = choice.source;
}
for (const [id] of photoEntries) if (!playerData.has(id)) throw new Error(`photo has unknown player ${id}`);

const coverageRows = tournamentDetails.map((tournament) => {
  const ids = Object.values(tournament.squads).flatMap((squad) => squad.map((member) => member.player));
  return { year: tournament.year, named: ids.filter((id) => playerData.get(id)?.ja).length, total: ids.length };
});
const nameDifferences = [];
for (const [id, matches] of [...Map.groupBy(japaneseSquadMatches, (item) => item.id)].sort(([a], [b]) => compare(a, b))) {
  const player = playerData.get(id);
  const names = matches
    .filter((item) => !validateJapaneseName(item.name, player.teams.has('JPN') ? 'JPN' : item.team))
    .map((item) => `${item.year}: ${item.name}`);
  if (new Set(names.map((item) => item.slice(item.indexOf(': ') + 2))).size > 1) nameDifferences.push(`${id} ${player.name} — ${names.join('; ')}`);
}
const reviewRows = [...playerData].filter(([, player]) => player.ja && !player.name.includes(' ') && player.ja.includes(' '))
  .sort(([a], [b]) => compare(a, b)).map(([id, player]) => `${id} ${player.name} — ${player.ja} (${player.jaSource})`);
const rejectionCounts = Map.groupBy(japaneseNames.rejections, (item) => item.reason);
const reportLines = [
  'COVERAGE BY TOURNAMENT',
  ...coverageRows.map((row) => `${row.year}: ${row.named}/${row.total} (${(row.named / row.total * 100).toFixed(1)}%)`),
  '', 'COUNTS BY SOURCE',
  ...Object.entries(japaneseNames.sourceCounts).map(([source, count]) => `${source}: ${count}`),
  '', 'REJECTION COUNTS BY REASON',
  ...[...rejectionCounts].sort(([a], [b]) => compare(a, b)).map(([reason, items]) => `${reason}: ${items.length}`),
  '', 'REJECTIONS',
  ...japaneseNames.rejections.map((item) => `${item.id}\t${item.source}\t${item.reason}\t${item.value}`),
  '', 'UNMATCHED OR AMBIGUOUS SQUAD ENTRIES',
  ...squadMatchProblems.map((item) => `${item.year}\t${item.team}\t${item.birthDate || '-'}\t${item.no ?? '-'}\t${item.reason}\t${item.rawName.replace(/\s+/g, ' ')}`),
  '', 'PLAYERS WHOSE SQUAD NAME DIFFERS BETWEEN YEARS',
  ...nameDifferences,
  '', 'REVIEW: SINGLE-WORD LATIN DISPLAY NAME WITH SPACED JAPANESE NAME',
  ...reviewRows,
  '',
];
await mkdir(join(ROOT, 'reports'), { recursive: true });
await writeFile(join(ROOT, 'reports/players-ja.txt'), reportLines.join('\n'));

for (const tournament of tournamentDetails) {
  const referenced = new Set([
    ...tournament.matches.flatMap((match) => match.goals.map((goal) => goal.player)),
    ...Object.values(tournament.squads).flatMap((squad) => squad.map((member) => member.player)),
    ...tournament.topScorers.map((scorer) => scorer.player),
    ...tournament.awards.map((award) => award.player),
  ]);
  tournament.people = {};
  for (const id of [...referenced].sort(compare)) {
    const player = playerData.get(id);
    if (!player) throw new Error(`missing display name for ${tournament.year} ${id}`);
    tournament.people[id] = { name: player.name, ja: player.ja };
  }
  for (const squad of Object.values(tournament.squads)) for (const member of squad) {
    const player = playerData.get(member.player);
    if (player.birthDate) member.age = ageInYears(player.birthDate, tournament.start);
    member.goals = player.goals;
    if ([...player.years].every((year) => year >= 1970)) {
      member.apps = Object.values(player.appsByYear).reduce((sum, value) => sum + value, 0);
    }
    member.photo = photoIds.has(member.player);
  }
}

const allMatches = tournamentDetails.flatMap((tournament) => tournament.matches.map((match) => ({ ...match, year: tournament.year })))
  .sort((a, b) => a.year - b.year || compare(a.date, b.date) || compare(a.id, b.id));
const outputTeams = {};
const allTeamKeys = Object.keys(curatedTeams).sort(compare);
const titleCounts = new Map(allTeamKeys.map((key) => [key, 0]));
const runnerUpCounts = new Map(allTeamKeys.map((key) => [key, 0]));
for (const tournament of tournamentSummaries) titleCounts.set(tournament.placings['1'], titleCounts.get(tournament.placings['1']) + 1);
for (const tournament of tournamentSummaries) runnerUpCounts.set(tournament.placings['2'], runnerUpCounts.get(tournament.placings['2']) + 1);
const predecessorMap = new Map(allTeamKeys.map((key) => [key, []]));
for (const key of allTeamKeys) if (curatedTeams[key].successor) predecessorMap.get(curatedTeams[key].successor).push(key);
const allPredecessors = (key, seen = new Set()) => {
  for (const predecessor of predecessorMap.get(key) || []) if (!seen.has(predecessor)) { seen.add(predecessor); allPredecessors(predecessor, seen); }
  return [...seen].sort(compare);
};
const lineageRoot = (key) => curatedTeams[key].successor ? lineageRoot(curatedTeams[key].successor) : key;
const confederationsByTeamId = new Map(teamRows.map((row) => [row.team_id, row.confederation_code]));
const regions = new Map();
for (const key of allTeamKeys) {
  const root = lineageRoot(key);
  const region = curatedTeams[root].fjelstulTeamId
    ? confederationsByTeamId.get(curatedTeams[root].fjelstulTeamId)
    : confederationFallbacks[root];
  if (!region) throw new Error(`missing region for ${key} (lineage root ${root})`);
  regions.set(key, region);
}
const resultFor = (match, key) => {
  const home = match.home === key;
  const gf = home ? match.score.home : match.score.away;
  const ga = home ? match.score.away : match.score.home;
  const shootout = Boolean(match.score.pens);
  return { gf, ga, w: !shootout && gf > ga ? 1 : 0, d: shootout || gf === ga ? 1 : 0, l: !shootout && gf < ga ? 1 : 0 };
};
const ownRecordFor = (key) => {
  const record = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (const match of allMatches) {
    if (match.home !== key && match.away !== key) continue;
    const result = resultFor(match, key);
    record.p += 1; record.gf += result.gf; record.ga += result.ga;
    record.w += result.w; record.d += result.d; record.l += result.l;
  }
  return record;
};
const finishOrder = ['champion', 'runner-up', 'third', 'fourth', 'sf', 'qf', 'r16', 'r32', 'second-group', 'final-round', 'group'];
for (const key of allTeamKeys) {
  const team = curatedTeams[key];
  const ownTournaments = [];
  for (const summary of tournamentSummaries) {
    const finish = finishByTeamYear.get(`${key}\0${summary.year}`);
    if (finish) ownTournaments.push({ year: summary.year, finish, team: key });
  }
  const recordOwn = ownRecordFor(key);
  const predecessors = allPredecessors(key);
  const lineage = [key, ...predecessors];
  const tournaments = lineage.flatMap((member) => tournamentSummaries.flatMap((summary) => {
    const finish = finishByTeamYear.get(`${member}\0${summary.year}`);
    return finish ? [{ year: summary.year, finish, team: member }] : [];
  })).sort((a, b) => a.year - b.year || compare(a.team, b.team));
  const record = lineage.reduce((total, member) => {
    const value = member === key ? recordOwn : ownRecordFor(member);
    for (const field of Object.keys(total)) total[field] += value[field];
    return total;
  }, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const opponentsByKey = new Map();
  for (const match of allMatches) {
    const member = lineage.find((item) => match.home === item || match.away === item);
    if (!member) continue;
    const opponent = match.home === member ? match.away : match.home;
    if (!opponentsByKey.has(opponent)) opponentsByKey.set(opponent, { team: opponent, p: 0, w: 0, d: 0, l: 0, matches: [] });
    const row = opponentsByKey.get(opponent);
    const result = resultFor(match, member);
    row.p += 1; row.w += result.w; row.d += result.d; row.l += result.l;
    row.matches.push({ id: match.id, year: match.year, date: match.date, home: match.home, away: match.away, homeGoals: match.score.home, awayGoals: match.score.away });
  }
  const scorerCounts = new Map();
  for (const goal of allMatches.flatMap((match) => match.goals)) {
    if (!goal.ownGoal && lineage.includes(goal.playerTeam)) scorerCounts.set(goal.player, (scorerCounts.get(goal.player) || 0) + 1);
  }
  const topScorers = [...scorerCounts].map(([player, goals]) => {
    const person = playerData.get(player);
    const playerTeam = [...person.teams].find((item) => lineage.includes(item)) || [...person.teams].sort(compare)[0];
    return { player, name: person.name, ja: person.ja, team: playerTeam, goals };
  }).sort((a, b) => b.goals - a.goals || compare(foldCompact(a.name), foldCompact(b.name)) || compare(a.player, b.player)).slice(0, 10);
  const titles = lineage.reduce((sum, member) => sum + titleCounts.get(member), 0);
  const runnerUps = lineage.reduce((sum, member) => sum + runnerUpCounts.get(member), 0);
  outputTeams[key] = {
    en: team.en, ja: team.ja, flag: team.flag, successor: team.successor,
    fjelstulTeamId: team.fjelstulTeamId, sourceNames: team.sourceNames,
    region: regions.get(key), tournaments, ownTournaments, record, recordOwn,
    titles: titleCounts.get(key), titlesWithPredecessors: titles, runnerUpsWithPredecessors: runnerUps,
    bestFinish: tournaments.slice().sort((a, b) => finishOrder.indexOf(a.finish) - finishOrder.indexOf(b.finish) || a.year - b.year)[0]?.finish || null,
    predecessors, opponents: [...opponentsByKey.values()], topScorers,
  };
}
for (const tournament of tournamentDetails) {
  const keys = new Set([
    ...tournament.hosts,
    ...tournament.matches.flatMap((match) => [match.home, match.away]),
    ...Object.keys(tournament.squads),
  ]);
  tournament.teamDisplay = {};
  for (const key of [...keys].sort(compare)) tournament.teamDisplay[key] = {
    ja: outputTeams[key].ja, flag: outputTeams[key].flag,
  };
}

const outputPlayers = {};
for (const id of [...playerData.keys()].sort(compare)) {
  const player = playerData.get(id);
  const goalsByYear = {};
  for (const year of Object.keys(player.goalsByYear).map(Number).sort((a, b) => a - b)) goalsByYear[year] = player.goalsByYear[year];
  const years = [...player.years].sort((a, b) => a - b);
  const output = { name: player.name, ja: player.ja, teams: [...player.teams].sort(compare), years, goals: player.goals, goalsByYear,
    awards: player.awards.slice().sort((a, b) => a[0] - b[0] || compare(a[1], b[1])) };
  if (player.birthDate) output.birthDate = player.birthDate;
  // Absence means the appearance source cannot provide a complete career total.
  // Zero is retained for eligible squad years in which the player never played.
  if (years.every((year) => year >= 1970)) {
    output.appsByYear = {};
    for (const year of years) output.appsByYear[year] = player.appsByYear[year] || 0;
    output.apps = Object.values(output.appsByYear).reduce((sum, value) => sum + value, 0);
  }
  outputPlayers[id] = output;
}

const birthdayBuckets = new Map();
for (const [id, player] of Object.entries(outputPlayers)) {
  if (!player.birthDate) continue;
  const key = player.birthDate.slice(5);
  if (!birthdayBuckets.has(key)) birthdayBuckets.set(key, []);
  birthdayBuckets.get(key).push({
    id,
    name: playerLabel(player, player.teams.includes('JPN') ? 'JPN' : player.teams.at(-1)),
    year: Number(player.birthDate.slice(0, 4)),
    photo: photoIds.has(id) ? 1 : 0,
    goals: player.goals,
    apps: player.apps ?? 0,
  });
}
const birthdays = {};
for (let offset = 0; offset < 366; offset += 1) {
  const key = new Date(Date.UTC(2000, 0, offset + 1)).toISOString().slice(5, 10);
  birthdays[key] = (birthdayBuckets.get(key) || [])
    .sort((a, b) => b.photo - a.photo || b.goals - a.goals || b.apps - a.apps || compare(a.id, b.id))
    .slice(0, 6)
    .map(({ id, name, year, photo }) => ({ id, name, year, photo }));
}

const countryTieOrder = (left, right) => compare(
  fold(rubyReading(outputTeams[left.team].ja)), fold(rubyReading(outputTeams[right.team].ja)),
) || compare(left.team, right.team);
const countryRoots = allTeamKeys.filter((key) => !curatedTeams[key].successor);
const countryRow = (team, value, extra = {}) => ({ team, name: outputTeams[team].en, ja: outputTeams[team].ja, value, ...extra });
const countryRankings = {
  titles: rankRows(countryRoots.filter((team) => outputTeams[team].titlesWithPredecessors > 0)
    .map((team) => countryRow(team, outputTeams[team].titlesWithPredecessors, { runnerUp: outputTeams[team].runnerUpsWithPredecessors })), {
    values: (row) => [row.value, row.runnerUp], secondary: countryTieOrder,
  }),
  appearances: rankRows(countryRoots.map((team) => countryRow(team, outputTeams[team].tournaments.length)), { secondary: countryTieOrder }),
  wins: rankRows(countryRoots.filter((team) => outputTeams[team].record.w > 0)
    .map((team) => countryRow(team, outputTeams[team].record.w)), { secondary: countryTieOrder }),
  goals: rankRows(countryRoots.filter((team) => outputTeams[team].record.gf > 0)
    .map((team) => countryRow(team, outputTeams[team].record.gf)), { secondary: countryTieOrder }),
};

const playerYearTeam = new Map();
for (const tournament of tournamentDetails) for (const [team, squad] of Object.entries(tournament.squads)) {
  for (const member of squad) playerYearTeam.set(`${member.player}\0${tournament.year}`, team);
}
const rankedPlayerRow = (player, value, extra = {}) => {
  const data = outputPlayers[player];
  const recentYear = data.years.at(-1);
  return { player, value, name: data.name, ja: data.ja, team: playerYearTeam.get(`${player}\0${recentYear}`) || data.teams.at(-1), recentYear, ...extra };
};
const playerRanking = (rows) => rankRows(rows, { secondary: playerTieOrder, limit: 50 });
const openingDayByYear = new Map(tournamentSummaries.map((tournament) => [tournament.year, tournament.start]));
const ageRankingRow = (id, pick) => {
  const player = outputPlayers[id];
  const appearances = player.years.map((year) => ({
    year,
    age: ageInYears(player.birthDate, openingDayByYear.get(year)),
    ageDays: ageInDays(player.birthDate, openingDayByYear.get(year)),
  }));
  const selected = appearances.reduce((best, item) => !best || pick(item.ageDays, best.ageDays) ? item : best, null);
  return rankedPlayerRow(id, selected.age, {
    year: selected.year, age: selected.age, ageDays: selected.ageDays,
    team: playerYearTeam.get(`${id}\0${selected.year}`) || player.teams.at(-1),
  });
};
const playerRankings = {
  goals: playerRanking(Object.entries(outputPlayers).filter(([, player]) => player.goals > 0)
    .map(([id, player]) => rankedPlayerRow(id, player.goals))),
  tournamentGoals: playerRanking(Object.entries(outputPlayers).flatMap(([id, player]) => Object.entries(player.goalsByYear)
    .map(([year, goals]) => rankedPlayerRow(id, goals, { year: number(year), team: playerYearTeam.get(`${id}\0${year}`) || player.teams.at(-1) })))),
  awards: playerRanking(Object.entries(outputPlayers).filter(([, player]) => player.awards.length > 0)
    .map(([id, player]) => rankedPlayerRow(id, player.awards.length))),
  squads: playerRanking(Object.entries(outputPlayers).map(([id, player]) => rankedPlayerRow(id, player.years.length))),
  apps: playerRanking(Object.entries(outputPlayers).filter(([, player]) => Object.hasOwn(player, 'apps'))
    .map(([id, player]) => rankedPlayerRow(id, player.apps))),
  youngest: rankRows(Object.entries(outputPlayers).filter(([, player]) => player.birthDate)
    .map(([id]) => ageRankingRow(id, (value, best) => value < best)), {
    values: (row) => [-row.ageDays], secondary: playerTieOrder, limit: 50,
  }),
  oldest: rankRows(Object.entries(outputPlayers).filter(([, player]) => player.birthDate)
    .map(([id]) => ageRankingRow(id, (value, best) => value > best)), {
    values: (row) => [row.ageDays], secondary: playerTieOrder, limit: 50,
  }),
};
for (const rows of Object.values(playerRankings)) for (const row of rows) delete row.recentYear;
const appearanceTotalsByYear = {};
for (const row of menAppearances) {
  const year = yearOf(row);
  appearanceTotalsByYear[year] = (appearanceTotalsByYear[year] || 0) + 1;
}
appearanceTotalsByYear[2026] = full2026.matches.reduce((total, match) => total + match.lineup.reduce((sideTotal, lineup) =>
  sideTotal + new Set([...(lineup.starter || []).map((item) => item.name), ...(lineup.subs || []).map((item) => item.on)]).size, 0), 0);
const rankings = { countries: countryRankings, players: playerRankings, appearanceTotalsByYear };

const compactMatches = allMatches.map((match) => [
  match.id, match.year, match.date, match.stage, match.home, match.away,
  match.score.home, match.score.away, match.score.aet ? 1 : 0,
  match.score.pens?.[0] ?? null, match.score.pens?.[1] ?? null,
]);
const matchOrder = (left, right) => compare(left.date, right.date) || compare(left.id, right.id);
const biggestWins = allMatches.slice().sort((a, b) => {
  const marginA = Math.abs(a.score.home - a.score.away), marginB = Math.abs(b.score.home - b.score.away);
  const goalsA = a.score.home + a.score.away, goalsB = b.score.home + b.score.away;
  return marginB - marginA || goalsB - goalsA || matchOrder(a, b);
}).slice(0, 20).map((match) => match.id);
const highestScoring = allMatches.slice().sort((a, b) =>
  (b.score.home + b.score.away) - (a.score.home + a.score.away) ||
  Math.abs(b.score.home - b.score.away) - Math.abs(a.score.home - a.score.away) || matchOrder(a, b))
  .slice(0, 20).map((match) => match.id);
const scorerRows = [...playerData].filter(([, player]) => player.goals > 0).map(([player, data]) => ({ player, goals: data.goals }))
  .sort((a, b) => b.goals - a.goals || compare(a.player, b.player));
const tournamentScorers = [...playerData].flatMap(([player, data]) => Object.entries(data.goalsByYear).map(([year, goals]) => ({ player, year: number(year), goals })))
  .sort((a, b) => b.goals - a.goals || a.year - b.year || compare(a.player, b.player)).slice(0, 50);
const hatTricks = [];
for (const match of allMatches) {
  const counts = new Map();
  for (const goal of match.goals) if (!goal.ownGoal) counts.set(goal.player, (counts.get(goal.player) || 0) + 1);
  for (const [player, goals] of counts) if (goals >= 3) hatTricks.push({ player, match: match.id, goals });
}
hatTricks.sort((a, b) => compare(a.match, b.match) || compare(a.player, b.player));
const records = {
  biggestWins, highestScoring, allTimeScorers: scorerRows.slice(0, 100), tournamentScorers,
  hatTricks, shootouts: allMatches.filter((match) => match.score.pens).map((match) => match.id),
  titles: allTeamKeys.map((team) => ({ team, titles: outputTeams[team].titles, titlesWithPredecessors: outputTeams[team].titlesWithPredecessors }))
    .filter((row) => row.titles || row.titlesWithPredecessors)
    .sort((a, b) => b.titlesWithPredecessors - a.titlesWithPredecessors || b.titles - a.titles || compare(a.team, b.team)),
};

let search = [];
const teamSearchKeys = new Map();
for (const key of allTeamKeys) {
  const team = outputTeams[key];
  teamSearchKeys.set(key, unique([fold(team.en), fold(rubyPlain(team.ja)), fold(rubyReading(team.ja))]));
}
for (const key of allTeamKeys) {
  const team = outputTeams[key];
  const successorKeys = team.successor ? teamSearchKeys.get(team.successor) : [];
  search.push({ type: 'team', id: key, label: team.en, keys: unique([...teamSearchKeys.get(key), ...successorKeys]) });
}
for (const id of Object.keys(outputPlayers)) {
  const player = outputPlayers[id];
  const source = playerData.get(id);
  const values = [fold(player.name), foldCompact(player.name)];
  if (player.ja) values.push(fold(player.ja), foldCompact(player.ja));
  if (source.teams.has('JPN') && source.reading) values.push(fold(source.reading), foldCompact(source.reading));
  const recentYear = player.years.at(-1);
  search.push({
    type: 'player', id, label: player.name, keys: unique(values), ja: player.ja,
    team: playerYearTeam.get(`${id}\0${recentYear}`) || player.teams.at(-1),
    years: [player.years[0], recentYear], fame: [player.goals, player.apps ?? 0, player.years.length],
  });
}
for (const tournament of tournamentSummaries) search.push({ type: 'tournament', id: String(tournament.year), label: `${tournament.year}`, keys: [String(tournament.year)] });
search = mergeSearchAliases(search, searchAliases);
search = addTournamentHostKeys(search, tournamentSummaries);
search.sort((a, b) => compare(a.type, b.type) || compare(a.id, b.id));

const meta = {
  schema: 1,
  sources: {
    openfootball: { sha: SOURCES.openfootball.sha, url: SOURCES.openfootball.url, license: SOURCES.openfootball.license },
    fjelstul: { sha: SOURCES.fjelstul.sha, url: SOURCES.fjelstul.url, license: SOURCES.fjelstul.license, attribution: SOURCES.fjelstul.attribution },
  },
  counts: { tournaments: tournamentSummaries.length, matches: allMatches.length, goals: allMatches.reduce((sum, match) => sum + match.goals.length, 0), teams: allTeamKeys.length, players: playerData.size },
};

const photoCredits = {};
for (const [id, photo] of photoEntries) {
  const player = playerData.get(id);
  const recentYear = [...player.years].sort((a, b) => a - b).at(-1);
  const team = playerYearTeam.get(`${id}\0${recentYear}`) || [...player.teams].sort(compare).at(-1);
  photoCredits[id] = {
    artist: photo.artist.trim(), licence: photo.licence,
    licenceUrl: photo.licenceUrl.replace(/^http:\/\/creativecommons\.org\//, 'https://creativecommons.org/'),
    source: photo.source.trim(), name: player.name, ja: player.ja, team,
  };
}

await mkdir(join(outputRoot, 't'), { recursive: true });
const writeJson = (name, value) => writeFile(join(outputRoot, name), `${JSON.stringify(value)}\n`);
await Promise.all([
  writeJson('meta.json', meta), writeJson('tournaments.json', tournamentSummaries),
  writeJson('teams.json', outputTeams), writeJson('players.json', outputPlayers),
  writeJson('matches.json', compactMatches), writeJson('records.json', records), writeJson('rankings.json', rankings), writeJson('search.json', search),
  writeJson('photos.json', photoCredits), writeJson('birthdays.json', birthdays),
  ...tournamentDetails.map((tournament) => writeJson(`t/${tournament.year}.json`, tournament)),
]);

console.log(`Built ${meta.counts.tournaments} tournaments, ${meta.counts.matches} matches, ${meta.counts.goals} goals`);
console.log(`Teams: ${meta.counts.teams}; players: ${meta.counts.players}`);
console.log(`2026 roster: ${roster2026.length}; linked to Fjelstul: ${linked2026}; new: ${roster2026.length - linked2026}`);
console.log(`2026 identity decisions: reviewed ${Object.values(identity2026).filter((item) => item.reviewed).length}; unreviewed ${Object.values(identity2026).filter((item) => !item.reviewed).length}`);
console.log(`Output: ${outputRoot}`);
console.log('Japanese player-name coverage:');
for (const row of coverageRows) console.log(`${row.year}: ${row.named}/${row.total} (${(row.named / row.total * 100).toFixed(1)}%)`);
