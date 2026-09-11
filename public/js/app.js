import { loadMeta, loadPlayers, loadRankings, loadTeams, loadTournament, loadTournaments } from './data.js?v=0.3.0';
import { el, replace, rubyEl, rubyNodes } from './dom.js?v=0.3.0';
import { STRINGS } from './strings.js?v=0.3.0';
import { countriesView, countryView, creditsView, errorView, homeView, matchView, notFoundView, playerView, rankingsView, tournamentView } from './views.js?v=0.3.0';
import { VERSION } from './version.js?v=0.3.0';

const root = document.querySelector('#app');

function shell() {
  const main = el('main', { id: 'main', 'aria-live': 'polite' });
  replace(root, [
    el('header', { class: 'site-header' }, el('div', { class: 'header-inner' }, [
      el('a', { class: 'brand', href: '#/' }, [
        el('img', { class: 'brand-mark', src: `assets/ball-mark.png?v=${VERSION}`, alt: '', width: 34, height: 34 }),
        el('strong', {}, 'Wcupedia'),
        rubyEl('span', STRINGS.subtitle, { class: 'subtitle' }),
        el('small', {}, STRINGS.logoReading),
      ]),
      el('nav', { class: 'site-nav', 'aria-label': 'main' }, [
        el('a', { href: '#/' }, rubyNodes(STRINGS.tournaments)),
        el('a', { href: '#/c' }, '国'),
        el('a', { href: '#/r' }, 'ランキング'),
        el('a', { href: '#/credits' }, rubyNodes(STRINGS.credits)),
      ]),
    ])),
    main,
    el('footer', { class: 'site-footer' }, [
      el('span', { id: 'version' }, `v${VERSION}`),
      el('a', { href: '#/credits' }, rubyNodes(STRINGS.credits)),
    ]),
  ]);
  return main;
}

const main = shell();
let routeNumber = 0;

async function renderRoute() {
  const current = ++routeNumber;
  const route = location.hash.slice(1) || '/';
  window.scrollTo(0, 0);
  try {
    let view;
    if (route === '/') {
      const [tournaments, teams] = await Promise.all([loadTournaments(), loadTeams()]);
      view = homeView(tournaments, teams);
    } else if (route === '/credits') {
      view = creditsView(await loadMeta());
    } else if (route === '/c') {
      view = countriesView(await loadTeams());
    } else if (route === '/r') {
      const [rankings, teams] = await Promise.all([loadRankings(), loadTeams()]);
      view = rankingsView(rankings, teams, 'c', 'titles');
    } else {
      const tournamentMatch = /^\/t\/(\d{4})$/.exec(route);
      const matchMatch = /^\/m\/(M-(\d{4})-(?:\d{2}|\d{3}))$/.exec(route);
      const countryMatch = /^\/c\/([A-Z]{3})$/.exec(route);
      const playerMatch = /^\/p\/(P(?:26-[a-f0-9]{10}|-\d+))$/.exec(route);
      const rankingMatch = /^\/r\/([cp])\/([A-Za-z]+)$/.exec(route);
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
        const players = await loadPlayers();
        const player = players[playerMatch[1]];
        view = player ? playerView(playerMatch[1], player, await Promise.all(player.years.map(loadTournament))) : notFoundView();
      } else if (rankingMatch) {
        const [kind, metric] = rankingMatch.slice(1);
        const allowed = kind === 'c' ? ['titles', 'appearances', 'wins', 'goals'] : ['goals', 'tournamentGoals', 'awards', 'squads', 'apps'];
        const [rankings, teams] = await Promise.all([loadRankings(), loadTeams()]);
        view = allowed.includes(metric) ? rankingsView(rankings, teams, kind, metric) : notFoundView();
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
