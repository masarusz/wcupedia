import { VERSION } from './version.js?v=0.5.4';
import { isIsoDate } from './ages.js?v=0.5.4';

const cache = new Map();

function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const validators = {
  'tournaments.json': (value) => Array.isArray(value) && value.length > 0
    && value.every((item) => validObject(item) && Number.isInteger(item.year) && isIsoDate(item.start)),
  'teams.json': (value) => validObject(value) && Object.keys(value).length > 0
    && Object.values(value).every((item) => validObject(item) && typeof item.ja === 'string' && typeof item.flag === 'string'
      && typeof item.region === 'string' && validObject(item.record) && validObject(item.recordOwn)
      && Array.isArray(item.tournaments) && Array.isArray(item.opponents) && Array.isArray(item.topScorers)),
  'players.json': (value) => validObject(value) && Object.keys(value).length > 0
    && Object.values(value).every((item) => validObject(item) && typeof item.name === 'string'
      && Array.isArray(item.teams) && Array.isArray(item.years) && Number.isInteger(item.goals)
      && validObject(item.goalsByYear) && Array.isArray(item.awards)
      && (!Object.hasOwn(item, 'birthDate') || isIsoDate(item.birthDate))
      && ((!Object.hasOwn(item, 'apps') && !Object.hasOwn(item, 'appsByYear'))
        || (Number.isInteger(item.apps) && item.apps >= 0 && validObject(item.appsByYear)))),
  'rankings.json': (value) => validObject(value) && validObject(value.countries) && validObject(value.players)
    && ['titles', 'appearances', 'wins', 'goals'].every((key) => Array.isArray(value.countries[key]))
    && ['goals', 'tournamentGoals', 'awards', 'squads', 'apps', 'youngest', 'oldest'].every((key) => Array.isArray(value.players[key]))
    && Object.values(value.countries).flat().every((row) => validObject(row) && Number.isInteger(row.rank)
      && typeof row.team === 'string' && typeof row.name === 'string' && typeof row.ja === 'string' && Number.isInteger(row.value))
    && Object.values(value.players).flat().every((row) => validObject(row) && Number.isInteger(row.rank)
      && typeof row.player === 'string' && typeof row.name === 'string' && typeof row.team === 'string' && Number.isInteger(row.value))
    && ['youngest', 'oldest'].every((key) => value.players[key].every((row) => Number.isInteger(row.year)
      && Number.isInteger(row.age) && Number.isInteger(row.ageDays))),
  'search.json': (value) => Array.isArray(value) && value.length > 0
    && value.every((item) => validObject(item) && ['team', 'player', 'tournament'].includes(item.type)
      && typeof item.id === 'string' && typeof item.label === 'string' && Array.isArray(item.keys)
      && item.keys.length > 0 && item.keys.every((key) => typeof key === 'string' && key.length > 0)
      && (item.type !== 'player' || ((item.ja === null || typeof item.ja === 'string') && typeof item.team === 'string'
        && Array.isArray(item.years) && item.years.length === 2 && item.years.every(Number.isInteger)
        && Array.isArray(item.fame) && item.fame.length === 3 && item.fame.every(Number.isInteger)))),
  'meta.json': (value) => validObject(value) && validObject(value.sources),
  'photos.json': (value) => validObject(value)
    && Object.values(value).every((item) => validObject(item) && typeof item.artist === 'string'
      && typeof item.licence === 'string' && typeof item.licenceUrl === 'string' && typeof item.source === 'string'
      && typeof item.name === 'string' && (item.ja === null || typeof item.ja === 'string') && typeof item.team === 'string'),
  tournament: (value) => validObject(value) && Number.isInteger(value.year) && isIsoDate(value.start)
    && Array.isArray(value.matches) && Array.isArray(value.groups) && validObject(value.people) && validObject(value.teamDisplay)
    && validObject(value.squads) && Object.values(value.squads).every((squad) => Array.isArray(squad)
      && squad.every((member) => validObject(member) && typeof member.player === 'string'
        && (member.no === null || Number.isInteger(member.no)) && ['GK', 'DF', 'MF', 'FW'].includes(member.pos)
        && Number.isInteger(member.goals) && typeof member.photo === 'boolean')),
};

async function load(path, validator) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${path}?v=${VERSION}`).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!validator(value)) throw new Error(`invalid data shape: ${path}`);
      return value;
    }).catch((error) => {
      cache.delete(path);
      throw error;
    }));
  }
  return cache.get(path);
}

export const loadTournaments = () => load('data/tournaments.json', validators['tournaments.json']);
export const loadTeams = () => load('data/teams.json', validators['teams.json']);
export const loadMeta = () => load('data/meta.json', validators['meta.json']);
export const loadTournament = (year) => load(`data/t/${year}.json`, validators.tournament);
export const loadPlayers = () => load('data/players.json', validators['players.json']);
export const loadRankings = () => load('data/rankings.json', validators['rankings.json']);
export const loadSearch = () => load('data/search.json', validators['search.json']);
export const loadPhotos = () => load('data/photos.json', validators['photos.json']);
