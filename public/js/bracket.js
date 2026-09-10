const ROUNDS = ['r32', 'r16', 'qf', 'sf', 'final'];

function winnerOf(match) {
  if (match.score.pens) return match.score.pens[0] > match.score.pens[1] ? match.home : match.away;
  if (match.score.home === match.score.away) return null;
  return match.score.home > match.score.away ? match.home : match.away;
}

function pairingKey(match) {
  return [match.home, match.away].sort().join('|');
}

function tiesForRound(matches, round) {
  const grouped = new Map();
  for (const match of matches.filter((item) => item.stage === round)) {
    const key = pairingKey(match);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(match);
  }
  return [...grouped.values()].map((games) => {
    const deciding = games.find((match) => match.replay) || games.at(-1);
    return {
      round,
      teams: [games[0].home, games[0].away],
      matches: games.map((match) => match.id),
      winner: winnerOf(deciding),
      feeders: [null, null],
    };
  });
}

export function buildBracket(tournamentFile) {
  const rounds = Object.fromEntries(ROUNDS.map((round) => [round, tiesForRound(tournamentFile.matches, round)]));
  for (let index = 1; index < ROUNDS.length; index += 1) {
    const previous = rounds[ROUNDS[index - 1]];
    for (const tie of rounds[ROUNDS[index]]) {
      tie.feeders = tie.teams.map((team) => previous.find((candidate) => candidate.winner === team) || null);
    }
  }
  const thirdMatch = tournamentFile.matches.find((match) => match.stage === 'third') || null;
  const third = thirdMatch ? {
    round: 'third', teams: [thirdMatch.home, thirdMatch.away], matches: [thirdMatch.id],
    winner: winnerOf(thirdMatch), feeders: [null, null],
  } : null;
  const root = rounds.final[0] || null;
  return { root, third, rounds };
}

export { winnerOf };
