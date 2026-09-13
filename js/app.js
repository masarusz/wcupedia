import { loadMatches, loadMeta, loadPhotos, loadPlayers, loadRankings, loadRecords, loadSearch, loadTeams, loadTournament, loadTournaments } from './data.js?v=1.0.0';
import { el, replace, rubyEl, rubyNodes } from './dom.js?v=1.0.0';
import { prepareIndex } from './search.js?v=1.0.0';
import { STRINGS } from './strings.js?v=1.0.0';
import { countriesView, countryView, creditsView, errorView, homeView, japanView, matchView, meikanView, notFoundView, photoCreditsView, playerView, rankingsView, recordsView, searchView, tournamentView } from './views.js?v=1.0.0';
import { VERSION } from './version.js?v=1.0.0';
import { backDecision } from './navigation.js?v=1.0.0';

const root = document.querySelector('#app');

function shell() {
  const main = el('main', { id: 'main', 'aria-live': 'polite' });
  const backSlot = el('span', { class: 'header-back-slot' });
  replace(root, [
    el('header', { class: 'site-header' }, el('div', { class: 'header-inner' }, [
      backSlot,
      el('a', { class: 'brand', href: '#/' }, [
        el('img', { class: 'brand-mark', src: `assets/ball-mark.png?v=${VERSION}`, alt: '', width: 34, height: 34 }),
        el('strong', {}, 'Wcupedia'),
        rubyEl('span', STRINGS.subtitle, { class: 'subtitle' }),
        el('small', {}, STRINGS.logoReading),
      ]),
      el('nav', { class: 'site-nav', 'aria-label': 'main' }, [
        el('a', { href: '#/' }, rubyNodes(STRINGS.tournaments)),
        el('a', { href: '#/c' }, '国'),
        el('a', { href: '#/z' }, '選手名鑑'),
        el('a', { href: '#/r' }, 'ランキング'),
        el('a', { href: '#/k' }, rubyNodes(STRINGS.records)),
        el('a', { href: '#/j' }, rubyNodes(STRINGS.japanFeature)),
        el('a', { href: '#/s' }, rubyNodes(STRINGS.search)),
        el('a', { href: '#/credits' }, rubyNodes(STRINGS.credits)),
      ]),
    ])),
    main,
    el('footer', { class: 'site-footer' }, [
      el('span', { id: 'version' }, `v${VERSION}`),
      el('a', { href: '#/credits' }, rubyNodes(STRINGS.credits)),
    ]),
  ]);
  return { main, backSlot };
}

const { main, backSlot } = shell();
let routeNumber = 0;
let searchContextPromise = null;
let currentRoute = '/';
let visitIndex = 0;
let visitEntryStamped = false;
const visitId = `${Date.now()}-${Math.random()}`;

const backButton = el('button', { class: 'header-back', type: 'button' }, '‹ 戻る');
backButton.addEventListener('click', () => {
  const decision = backDecision(currentRoute, visitIndex > 0);
  if (decision.action === 'back') history.back();
  else location.hash = decision.hash;
});

function stampVisitEntry(route) {
  const state = history.state && typeof history.state === 'object' ? history.state : {};
  if (state.wcupediaVisit === visitId && Number.isInteger(state.wcupediaVisitIndex)) {
    visitIndex = state.wcupediaVisitIndex;
  } else {
    if (visitEntryStamped) visitIndex += 1;
    history.replaceState({ ...state, wcupediaVisit: visitId, wcupediaVisitIndex: visitIndex }, '');
  }
  visitEntryStamped = true;
  currentRoute = route;
  backSlot.replaceChildren(...(route === '/' ? [] : [backButton]));
}

function loadSearchContext() {
  if (!searchContextPromise) {
    searchContextPromise = Promise.all([loadSearch(), loadTeams(), loadTournaments()])
      .then(([entries, teams, tournaments]) => ({ index: prepareIndex(entries), teams, tournaments }))
      .catch((error) => {
        searchContextPromise = null;
        throw error;
      });
  }
  return searchContextPromise;
}

function searchOptions(path, query, eager = false) {
  return {
    initialQuery: query,
    eager,
    loadContext: loadSearchContext,
    updateUrl: (value) => {
      const suffix = value ? `?q=${encodeURIComponent(value)}` : '';
      history.replaceState(history.state, '', `#${path}${suffix}`);
    },
  };
}

async function renderRoute() {
  const current = ++routeNumber;
  const routeValue = location.hash.slice(1) || '/';
  const separator = routeValue.indexOf('?');
  const route = separator < 0 ? routeValue : routeValue.slice(0, separator);
  stampVisitEntry(route);
  const parameters = new URLSearchParams(separator < 0 ? '' : routeValue.slice(separator + 1));
  const query = parameters.get('q') || '';
  window.scrollTo(0, 0);
  try {
    let view;
    if (route === '/') {
      const [tournaments, teams, matches] = await Promise.all([loadTournaments(), loadTeams(), loadMatches()]);
      view = homeView(tournaments, teams, matches, searchOptions('/', query));
    } else if (route === '/s') {
      view = searchView(searchOptions('/s', query, true));
    } else if (route === '/credits') {
      view = creditsView(await loadMeta());
    } else if (route === '/credits/photos') {
      view = photoCreditsView(await loadPhotos());
    } else if (route === '/c') {
      view = countriesView(await loadTeams());
    } else if (route === '/r') {
      const [rankings, teams] = await Promise.all([loadRankings(), loadTeams()]);
      view = rankingsView(rankings, teams, 'c', 'titles');
    } else if (route === '/k') {
      const [records, matches, tournaments, teams, players] = await Promise.all([
        loadRecords(), loadMatches(), loadTournaments(), loadTeams(), loadPlayers(),
      ]);
      view = recordsView(records, matches, tournaments, teams, players);
    } else if (route === '/j') {
      const teams = await loadTeams();
      view = japanView(teams.JPN, await Promise.all(teams.JPN.tournaments.map(({ year }) => loadTournament(year))), teams);
    } else {
      const tournamentMatch = /^\/t\/(\d{4})$/.exec(route);
      const matchMatch = /^\/m\/(M-(\d{4})-(?:\d{2}|\d{3}))$/.exec(route);
      const countryMatch = /^\/c\/([A-Z]{3})$/.exec(route);
      const playerMatch = /^\/p\/(P(?:26-[a-f0-9]{10}|-\d+))$/.exec(route);
      const rankingMatch = /^\/r\/([cp])\/([A-Za-z]+)$/.exec(route);
      const meikanMatch = /^\/z(?:\/(\d{4})(?:\/([A-Z]{3}))?)?$/.exec(route);
      if (tournamentMatch) {
        const year = Number(tournamentMatch[1]);
        const [tournaments, teams] = await Promise.all([loadTournaments(), loadTeams()]);
        view = tournaments.some((item) => item.year === year)
          ? tournamentView(await loadTournament(year), teams) : notFoundView();
      } else if (matchMatch) {
        const year = Number(matchMatch[2]);
        const [tournaments, teams] = await Promise.all([loadTournaments(), loadTeams()]);
        if (!tournaments.some((item) => item.year === year)) {
          view = notFoundView();
        } else {
          const detail = await loadTournament(year);
          const match = detail.matches.find((item) => item.id === matchMatch[1]);
          view = match ? matchView(detail, match, teams) : notFoundView();
        }
      } else if (countryMatch) {
        const teams = await loadTeams();
        view = teams[countryMatch[1]] ? countryView(countryMatch[1], teams) : notFoundView();
      } else if (playerMatch) {
        const [players, photos] = await Promise.all([loadPlayers(), loadPhotos()]);
        const player = players[playerMatch[1]];
        view = player ? playerView(playerMatch[1], player, await Promise.all(player.years.map(loadTournament)), null, photos[playerMatch[1]] || null) : notFoundView();
      } else if (rankingMatch) {
        const [kind, metric] = rankingMatch.slice(1);
        const allowed = kind === 'c' ? ['titles', 'appearances', 'wins', 'goals'] : ['goals', 'tournamentGoals', 'awards', 'squads', 'apps', 'youngest', 'oldest'];
        const [rankings, teams] = await Promise.all([loadRankings(), loadTeams()]);
        view = allowed.includes(metric) ? rankingsView(rankings, teams, kind, metric) : notFoundView();
      } else if (meikanMatch) {
        const year = Number(meikanMatch[1] || 2026);
        const [tournaments, teams] = await Promise.all([loadTournaments(), loadTeams()]);
        if (!tournaments.some((item) => item.year === year)) view = notFoundView();
        else {
          const detail = await loadTournament(year);
          const selectedTeam = meikanMatch[2] || null;
          view = selectedTeam && !detail.squads[selectedTeam]
            ? notFoundView() : meikanView(detail, teams, tournaments, selectedTeam);
        }
      } else {
        view = notFoundView();
      }
    }
    if (current === routeNumber) replace(main, view);
  } catch (error) {
    console.error(error);
    if (current === routeNumber) replace(main, errorView(renderRoute));
  }
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
