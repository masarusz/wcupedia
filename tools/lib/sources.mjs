export const OPENFOOTBALL_SHA = '516d3825c3bd23fdc298c4014e84bde78f2d4965';
export const FJELSTUL_SHA = '35a8667f518b07469182ae16d35574dd0e7a00fb';
export const OPENFOOTBALL_REPO = 'openfootball/worldcup.json';
export const FJELSTUL_REPO = 'jfjelstul/worldcup';

const openfootballFile = (localFile, remotePath) => ({ localFile, remotePath });
const fjelstulFile = (localFile) => ({ localFile, remotePath: `data-csv/${localFile}` });

export const SOURCES = {
  openfootball: {
    sha: OPENFOOTBALL_SHA,
    repo: OPENFOOTBALL_REPO,
    url: `https://github.com/${OPENFOOTBALL_REPO}`,
    license: 'CC0-1.0',
    files: [
      ...[1930, 1934, 1938, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026]
        .map((year) => openfootballFile(`${year}-full.json`, `${year}/worldcup-full.json`)),
      openfootballFile('2026-squads.json', '2026/worldcup.squads.json'),
      openfootballFile('2026-teams.json', '2026/worldcup.teams.json'),
      openfootballFile('2026-groups.json', '2026/worldcup.groups.json'),
      openfootballFile('2026-stadiums.json', '2026/worldcup.stadiums.json'),
    ],
  },
  fjelstul: {
    sha: FJELSTUL_SHA,
    repo: FJELSTUL_REPO,
    url: `https://github.com/${FJELSTUL_REPO}`,
    license: 'CC-BY-SA-4.0',
    attribution: '© 2023 Joshua C. Fjelstul, Ph.D.',
    files: [
      'award_winners.csv', 'awards.csv', 'goals.csv', 'group_standings.csv',
      'host_countries.csv', 'matches.csv', 'player_appearances.csv', 'players.csv', 'qualified_teams.csv',
      'squads.csv', 'teams.csv', 'tournament_stages.csv',
      'tournament_standings.csv', 'tournaments.csv',
    ].map(fjelstulFile),
  },
};

export function rawUrl(sourceName, localFile) {
  const source = SOURCES[sourceName];
  if (!source) throw new Error(`Unknown source: ${sourceName}`);
  const file = source.files.find((entry) => entry.localFile === localFile);
  if (!file) throw new Error(`Unknown file for ${sourceName}: ${localFile}`);
  return `https://raw.githubusercontent.com/${source.repo}/${source.sha}/${file.remotePath}`;
}
