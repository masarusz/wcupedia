import { VERSION } from './version.js?v=0.2.5';

const cache = new Map();

function validObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const validators = {
  'tournaments.json': (value) => Array.isArray(value) && value.length > 0
    && value.every((item) => validObject(item) && Number.isInteger(item.year)),
  'teams.json': (value) => validObject(value) && Object.keys(value).length > 0
    && Object.values(value).every((item) => validObject(item) && typeof item.ja === 'string' && typeof item.flag === 'string'),
  'meta.json': (value) => validObject(value) && validObject(value.sources),
  tournament: (value) => validObject(value) && Number.isInteger(value.year)
    && Array.isArray(value.matches) && Array.isArray(value.groups) && validObject(value.people),
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
