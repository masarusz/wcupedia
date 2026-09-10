const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const BOOKING_DEDUCTIONS = new Map([
  ['Y', -1],
  ['Y/R', -3],
  ['R', -4],
]);

export function conductScore(bookings) {
  const byPlayer = new Map();
  for (const booking of bookings || []) {
    if (!BOOKING_DEDUCTIONS.has(booking.type)) throw new Error(`unknown 2026 booking type ${JSON.stringify(booking.type)}`);
    if (!booking.name) throw new Error('2026 booking lacks a player name');
    if (!byPlayer.has(booking.name)) byPlayer.set(booking.name, new Set());
    byPlayer.get(booking.name).add(booking.type);
  }
  let score = 0;
  for (const types of byPlayer.values()) {
    // FIFA permits one deduction per player per match. Y/R replaces its first Y;
    // a separately recorded direct R plus Y is the combined -5 offence.
    if (types.has('Y/R')) score -= 3;
    else if (types.has('R') && types.has('Y')) score -= 5;
    else if (types.has('R')) score -= 4;
    else score -= 1;
  }
  return score;
}

function addResult(stats, match) {
  const home = stats.get(match.home);
  const away = stats.get(match.away);
  if (!home || !away) return;
  home.p += 1;
  away.p += 1;
  home.gf += match.score.home;
  home.ga += match.score.away;
  away.gf += match.score.away;
  away.ga += match.score.home;
  if (match.score.home > match.score.away) {
    home.w += 1;
    away.l += 1;
    home.pts += 3;
  } else if (match.score.home < match.score.away) {
    away.w += 1;
    home.l += 1;
    away.pts += 3;
  } else {
    home.d += 1;
    away.d += 1;
    home.pts += 1;
    away.pts += 1;
  }
}

function statsFor(teams, matches, includeConduct = false) {
  const stats = new Map(teams.map((team) => [team, {
    team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, conduct: 0,
  }]));
  for (const match of matches) {
    if (!stats.has(match.home) || !stats.has(match.away)) continue;
    addResult(stats, match);
    if (includeConduct) {
      stats.get(match.home).conduct += conductScore(match.bookings?.home);
      stats.get(match.away).conduct += conductScore(match.bookings?.away);
    }
  }
  for (const stat of stats.values()) stat.gd = stat.gf - stat.ga;
  return stats;
}

function partitions(items, equal) {
  const result = [];
  for (const item of items) {
    const last = result.at(-1);
    if (!last || !equal(last[0], item)) result.push([item]);
    else last.push(item);
  }
  return result;
}

function headToHeadClusters(teams, matches) {
  if (teams.length <= 1) return [teams];
  const stats = statsFor(teams, matches);
  const sorted = teams.slice().sort((left, right) => {
    const a = stats.get(left);
    const b = stats.get(right);
    return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || compare(left, right);
  });
  const tied = partitions(sorted, (left, right) => {
    const a = stats.get(left);
    const b = stats.get(right);
    return a.pts === b.pts && a.gd === b.gd && a.gf === b.gf;
  });
  if (tied.length === 1) return [sorted];
  return tied.flatMap((part) => part.length === 1 ? [part] : headToHeadClusters(part, matches));
}

function orderFromOverride(tied, override, groupName) {
  if (!Array.isArray(override)) return null;
  const tiedSet = new Set(tied);
  const order = override.filter((team) => tiedSet.has(team));
  if (order.length !== tied.length || new Set(order).size !== tied.length) {
    throw new Error(`invalid 2026 standings override for ${groupName}: expected ${tied.join(', ')}`);
  }
  return order;
}

export function rankGroup2026(teams, matches, { groupName = 'group', override = null } = {}) {
  const overall = statsFor(teams, matches, true);
  const byPoints = teams.slice().sort((left, right) => overall.get(right).pts - overall.get(left).pts || compare(left, right));
  const pointGroups = partitions(byPoints, (left, right) => overall.get(left).pts === overall.get(right).pts);
  const ordered = [];
  for (const pointGroup of pointGroups) {
    for (const cluster of headToHeadClusters(pointGroup, matches)) {
      if (cluster.length === 1) {
        ordered.push(cluster[0]);
        continue;
      }
      const afterOverall = cluster.slice().sort((left, right) => {
        const a = overall.get(left);
        const b = overall.get(right);
        return b.gd - a.gd || b.gf - a.gf || b.conduct - a.conduct || compare(left, right);
      });
      const finalTies = partitions(afterOverall, (left, right) => {
        const a = overall.get(left);
        const b = overall.get(right);
        return a.gd === b.gd && a.gf === b.gf && a.conduct === b.conduct;
      });
      for (const finalTie of finalTies) {
        if (finalTie.length === 1) ordered.push(finalTie[0]);
        else {
          const decided = orderFromOverride(finalTie, override, groupName);
          if (!decided) {
            const state = finalTie.map((team) => {
              const row = overall.get(team);
              return { team, pts: row.pts, gd: row.gd, gf: row.gf, conduct: row.conduct };
            });
            throw new Error(`unresolved 2026 standings tie in ${groupName}: ${JSON.stringify(state)}`);
          }
          ordered.push(...decided);
        }
      }
    }
  }
  return ordered.map((team) => overall.get(team));
}
