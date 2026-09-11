import { loadMeta, loadTeams, loadTournament, loadTournaments } from './data.js?v=0.2.10';
import { el, replace, rubyEl, rubyNodes } from './dom.js?v=0.2.10';
import { STRINGS } from './strings.js?v=0.2.10';
import { creditsView, errorView, homeView, matchView, notFoundView, tournamentView } from './views.js?v=0.2.10';
import { VERSION } from './version.js?v=0.2.10';

const root = document.querySelector('#app');

function shell() {
  const main = el('main', { id: 'main', 'aria-live': 'polite' });
  replace(root, [
    el('header', { class: 'site-header' }, el('div', { class: 'header-inner' }, [
      el('a', { class: 'brand', href: '#/' }, [
        el('strong', {}, 'Wcupedia'),
        rubyEl('span', STRINGS.subtitle, { class: 'subtitle' }),
        el('small', {}, STRINGS.logoReading),
      ]),
      el('nav', { class: 'site-nav', 'aria-label': 'main' }, [
        el('a', { href: '#/' }, rubyNodes(STRINGS.tournaments)),
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
    } else {
      const tournamentMatch = /^\/t\/(\d{4})$/.exec(route);
      const matchMatch = /^\/m\/(M-(\d{4})-(?:\d{2}|\d{3}))$/.exec(route);
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
