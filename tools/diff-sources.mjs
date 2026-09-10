#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { foldCompact } from '../public/js/fold.js';

const sourceRoot = resolve('.cache/sources');
const reportPath = resolve('reports/source-diff.txt');
const years = [1930, 1934, 1938, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022];
const teams = JSON.parse(await readFile(resolve('curated/teams.json'), 'utf8'));
const teamIds = new Map();
const teamNames = new Map();
for (const [key, team] of Object.entries(teams)) {
  if (team.fjelstulTeamId) teamIds.set(team.fjelstulTeamId, key);
  for (const name of team.sourceNames) teamNames.set(name, key);
}
const matches = parseCsv(await readFile(join(sourceRoot, 'fjelstul/matches.csv'), 'utf8')).filter((row) => row.tournament_name.includes("Men's"));
const goals = parseCsv(await readFile(join(sourceRoot, 'fjelstul/goals.csv'), 'utf8')).filter((row) => row.tournament_name.includes("Men's"));
const goalsByMatch = new Map();
for (const goal of goals) {
  if (!goalsByMatch.has(goal.match_id)) goalsByMatch.set(goal.match_id, []);
  goalsByMatch.get(goal.match_id).push(goal);
}
const pairKey = (date, first, second) => `${date}\0${[first, second].sort().join('\0')}`;
const details = [];
const summaryLines = [];
const totals = { paired: 0, missing: 0, score: 0, aet: 0, shootout: 0, goals: 0, scorers: 0 };

for (const year of years) {
  const source = JSON.parse(await readFile(join(sourceRoot, `openfootball/${year}-full.json`), 'utf8'));
  const fMatches = matches.filter((row) => row.tournament_id === `WC-${year}`);
  const lookup = new Map(fMatches.map((row) => [pairKey(row.match_date, teamIds.get(row.home_team_id), teamIds.get(row.away_team_id)), row]));
  const count = { paired: 0, missing: 0, score: 0, aet: 0, shootout: 0, goals: 0, scorers: 0 };
  for (const open of source.matches) {
    const openHome = teamNames.get(open.team1);
    const openAway = teamNames.get(open.team2);
    const key = pairKey(open.date, openHome, openAway);
    const fjelstul = lookup.get(key);
    if (!fjelstul) {
      count.missing += 1;
      details.push(`${year} missing pair: ${open.date} ${open.team1} - ${open.team2}`);
      continue;
    }
    count.paired += 1;
    const openResult = Array.isArray(open.score) ? open.score : (open.score.et || open.score.ft);
    const fResult = [Number(fjelstul.home_team_score), Number(fjelstul.away_team_score)];
    const sameOrientation = openHome === teamIds.get(fjelstul.home_team_id);
    const orientedResult = sameOrientation ? openResult : [openResult[1], openResult[0]];
    if (orientedResult[0] !== fResult[0] || orientedResult[1] !== fResult[1]) {
      count.score += 1;
      details.push(`${year} ${fjelstul.match_id} score: Fjelstul ${fResult.join('-')}, openfootball ${orientedResult.join('-')}`);
    }
    if (Boolean(!Array.isArray(open.score) && open.score.et) !== (fjelstul.extra_time === '1')) {
      count.aet += 1;
      details.push(`${year} ${fjelstul.match_id} aet differs`);
    }
    const openPens = !Array.isArray(open.score) && open.score.p ? open.score.p : null;
    const fPens = fjelstul.penalty_shootout === '1' ? [Number(fjelstul.home_team_score_penalties), Number(fjelstul.away_team_score_penalties)] : null;
    const orientedPens = openPens && !sameOrientation ? [openPens[1], openPens[0]] : openPens;
    if (JSON.stringify(orientedPens) !== JSON.stringify(fPens)) {
      count.shootout += 1;
      details.push(`${year} ${fjelstul.match_id} shootout: Fjelstul ${JSON.stringify(fPens)}, openfootball ${JSON.stringify(orientedPens)}`);
    }
    const openGoalCounts = sameOrientation ? [(open.goals1 || []).length, (open.goals2 || []).length] : [(open.goals2 || []).length, (open.goals1 || []).length];
    const fGoals = goalsByMatch.get(fjelstul.match_id) || [];
    const fGoalCounts = [fGoals.filter((goal) => goal.home_team === '1').length, fGoals.filter((goal) => goal.away_team === '1').length];
    if (openGoalCounts[0] !== fGoalCounts[0] || openGoalCounts[1] !== fGoalCounts[1]) {
      count.goals += 1;
      details.push(`${year} ${fjelstul.match_id} goal counts: Fjelstul ${fGoalCounts.join('-')}, openfootball ${openGoalCounts.join('-')}`);
    }
    const scorerCounts = (items, getName) => {
      const result = {};
      for (const item of items) {
        const name = foldCompact(getName(item));
        result[name] = (result[name] || 0) + 1;
      }
      return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    };
    const openScorers = scorerCounts([...(open.goals1 || []), ...(open.goals2 || [])], (goal) => goal.name);
    const fScorers = scorerCounts(fGoals, (goal) => goal.given_name === 'not applicable' ? goal.family_name : `${goal.given_name} ${goal.family_name}`);
    if (JSON.stringify(openScorers) !== JSON.stringify(fScorers)) {
      count.scorers += 1;
      const differences = [...new Set([...Object.keys(openScorers), ...Object.keys(fScorers)])].sort()
        .filter((name) => (fScorers[name] || 0) !== (openScorers[name] || 0))
        .map((name) => `${name}:${fScorers[name] || 0}/${openScorers[name] || 0}`);
      details.push(`${year} ${fjelstul.match_id} scorer counts (Fjelstul/openfootball): ${differences.join(', ')}`);
    }
  }
  for (const key of Object.keys(count)) totals[key] += count[key];
  const line = `${year}: paired ${count.paired}/${fMatches.length}; missing ${count.missing}; score ${count.score}; aet ${count.aet}; shootout ${count.shootout}; goal-count ${count.goals}; scorer-count ${count.scorers}`;
  summaryLines.push(line);
  console.log(line);
}
const totalLine = `TOTAL: paired ${totals.paired}; missing ${totals.missing}; score ${totals.score}; aet ${totals.aet}; shootout ${totals.shootout}; goal-count ${totals.goals}; scorer-count ${totals.scorers}`;
console.log(totalLine);
await mkdir(resolve('reports'), { recursive: true });
await writeFile(reportPath, `${summaryLines.join('\n')}\n${totalLine}\n\nDETAILS\n${details.join('\n')}\n`);
console.log(`Report: ${reportPath}`);
