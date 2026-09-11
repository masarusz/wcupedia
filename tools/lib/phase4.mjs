import { foldCompact } from '../../public/js/fold.js';

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function applySquadChanges(roster, changes) {
  const result = roster.map((player) => ({ ...player }));
  for (const change of changes) {
    const outgoing = result.filter((player) => player.team === change.team
      && player.name === change.out.name && player.date_of_birth === change.out.dateOfBirth);
    if (outgoing.length !== 1) {
      throw new Error(`squad change out missing from source squad: ${change.team} ${change.out.name} ${change.out.dateOfBirth}`);
    }
    if (result.some((player) => player.team === change.team
      && player.name === change.in.name && player.date_of_birth === change.in.dateOfBirth)) {
      throw new Error(`squad change in already present in source squad: ${change.team} ${change.in.name} ${change.in.dateOfBirth}`);
    }
    result.splice(result.indexOf(outgoing[0]), 1, {
      team: change.team,
      name: change.in.name,
      date_of_birth: change.in.dateOfBirth,
      number: change.in.number,
      pos: change.in.pos,
    });
  }
  return result;
}

export function rankRows(rows, {
  values = (row) => [row.value],
  secondary = (left, right) => compare(left.id, right.id),
  limit = null,
} = {}) {
  const valueList = (row) => {
    const result = values(row);
    return Array.isArray(result) ? result : [result];
  };
  const compareValues = (left, right) => {
    const a = valueList(left), b = valueList(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (b[index] ?? 0) - (a[index] ?? 0);
      if (difference) return difference;
    }
    return 0;
  };
  const sorted = rows.slice().sort((left, right) => compareValues(left, right) || secondary(left, right));
  let previous = null;
  for (let index = 0; index < sorted.length; index += 1) {
    if (!previous || compareValues(previous, sorted[index]) !== 0) sorted[index].rank = index + 1;
    else sorted[index].rank = previous.rank;
    previous = sorted[index];
  }
  if (limit === null || sorted.length <= limit) return sorted;
  const boundaryRank = sorted[limit - 1].rank;
  return sorted.filter((row) => row.rank <= boundaryRank);
}

export function playerTieOrder(left, right) {
  return right.recentYear - left.recentYear
    || compare(foldCompact(left.name), foldCompact(right.name))
    || compare(left.player, right.player)
    || (right.year || 0) - (left.year || 0);
}

export function resolveLineups2026(matches, keyForTeamName, resolvePlayer) {
  const counts = new Map();
  const missing = new Set();
  const resolve = (name, team) => {
    const player = resolvePlayer(name, team);
    if (!player) missing.add(`${team}: ${name}`);
    return player;
  };
  for (const match of matches) {
    const teams = [keyForTeamName(match.team1), keyForTeamName(match.team2)];
    if (!Array.isArray(match.lineup) || match.lineup.length !== 2) throw new Error(`invalid 2026 line-up: ${match.team1} vs ${match.team2}`);
    for (let side = 0; side < 2; side += 1) {
      const lineup = match.lineup[side];
      const appeared = new Set();
      for (const item of lineup.starter || []) {
        const player = resolve(item.name, teams[side]);
        if (player) appeared.add(player.id);
      }
      for (const item of lineup.bench || []) resolve(item.name, teams[side]);
      for (const item of lineup.subs || []) {
        const on = resolve(item.on, teams[side]);
        resolve(item.off, teams[side]);
        if (on) appeared.add(on.id);
      }
      for (const id of appeared) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  if (missing.size) throw new Error(`unresolved 2026 line-up names:\n${[...missing].sort(compare).join('\n')}`);
  return counts;
}
