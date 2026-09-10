import { buildBracket } from './bracket.js?v=0.1.0';
import { el, rubyEl, rubyNodes, text } from './dom.js?v=0.1.0';
import { formatDate, formatMinute, signed, tournamentTitle } from './format.js?v=0.1.0';
import { AWARD_LABELS, stageLabel, STRINGS } from './strings.js?v=0.1.0';
import { VERSION } from './version.js?v=0.1.0';

function flag(teams, key) {
  return el('img', {
    class: 'flag', src: `assets/flags/${teams[key].flag}.svg?v=${VERSION}`,
    alt: '', width: '24', height: '18',
  });
}

function team(teams, key, className = 'team') {
  return el('span', { class: className }, [flag(teams, key), rubyNodes(teams[key].ja)]);
}

function playerName(detail, id) {
  const person = detail.people[id];
  return person?.ja ? rubyNodes(person.ja) : text(person?.name || id);
}

function badge(markup, className = '') {
  return rubyEl('span', markup, { class: `badge ${className}`.trim() });
}

function scoreBadges(match) {
  const badges = [];
  if (match.score.aet) badges.push(badge(STRINGS.extraTime));
  if (match.score.pens) badges.push(el('span', { class: 'badge' }, `PK ${match.score.pens[0]}–${match.score.pens[1]}`));
  if (match.replay) badges.push(badge(STRINGS.replay));
  return badges;
}

function matchLink(match, teams, extraClass = '') {
  return el('a', { class: `match-link ${extraClass}`.trim(), href: `#/m/${match.id}` }, [
    team(teams, match.home),
    el('strong', { class: 'score' }, `${match.score.home}–${match.score.away}`),
    team(teams, match.away),
    el('span', { class: 'match-badges' }, scoreBadges(match)),
  ]);
}

function stat(markup, value) {
  return el('div', { class: 'stat' }, [rubyEl('span', markup), el('strong', {}, String(value))]);
}

function hostList(detail, teams) {
  return el('div', { class: 'team-list' }, detail.hosts.map((key) => team(teams, key)));
}

export function homeView(tournaments, teams) {
  const cards = [...tournaments].sort((a, b) => b.year - a.year).map((tournament) => {
    const champion = tournament.placings['1'];
    return el('a', { class: 'tournament-card', href: `#/t/${tournament.year}` }, [
      rubyEl('h2', tournamentTitle(tournament, teams)),
      el('div', { class: 'host-flags', 'aria-label': 'hosts' }, tournament.hosts.map((key) => flag(teams, key))),
      el('p', { class: 'champion' }, [text('🏆 '), rubyNodes(STRINGS.champion), text(' '), team(teams, champion)]),
      el('p', { class: 'card-count' }, [String(tournament.teams), rubyNodes(STRINGS.teams)]),
    ]);
  });
  return el('section', { class: 'page home-page' }, [
    rubyEl('h1', STRINGS.tournaments),
    rubyEl('p', STRINGS.intro, { class: 'intro' }),
    el('div', { class: 'tournament-grid' }, cards),
  ]);
}

function podium(detail, teams) {
  const labels = { '1': STRINGS.champion, '2': STRINGS.runnerUp, '3': STRINGS.third, '4': STRINGS.fourth };
  const rows = Object.keys(labels).filter((place) => detail.placings[place]).map((place) =>
    el('li', { class: place === '1' ? 'podium-first' : '' }, [rubyEl('strong', labels[place]), team(teams, detail.placings[place])]));
  return el('section', { class: 'panel' }, [rubyEl('h2', STRINGS.podium), el('ol', { class: 'podium' }, rows)]);
}

function honours(detail, teams) {
  const scorerRows = detail.topScorers.map((scorer) => {
    const scorerGoal = detail.matches.flatMap((match) => match.goals).find((goal) => goal.player === scorer.player && !goal.ownGoal);
    return el('li', {}, [
      el('span', { class: 'person' }, playerName(detail, scorer.player)),
      team(teams, scorerGoal.team),
      el('strong', {}, `${scorer.goals}`), rubyNodes(STRINGS.goals),
    ]);
  });
  const awardRows = detail.awards.map((award) => el('li', {}, [
    rubyEl('strong', AWARD_LABELS[award.award] || award.award),
    el('span', { class: 'person' }, playerName(detail, award.player)),
    team(teams, award.team),
  ]));
  return el('section', { class: 'panel honours' }, [
    rubyEl('h2', STRINGS.topScorer), el('ul', {}, scorerRows),
    awardRows.length ? rubyEl('h2', STRINGS.awards) : null,
    awardRows.length ? el('ul', {}, awardRows) : null,
  ]);
}

function standingsTable(group, teams) {
  const headers = [STRINGS.rank, STRINGS.country, STRINGS.played, STRINGS.wins, STRINGS.draws, STRINGS.losses,
    STRINGS.goalsFor, STRINGS.goalsAgainst, STRINGS.goalDifference, STRINGS.points];
  return el('div', { class: 'table-scroll', role: 'region', 'aria-label': 'standings' }, el('table', { class: 'standings' }, [
    el('thead', {}, el('tr', {}, headers.map((label) => rubyEl('th', label, { scope: 'col' })))),
    el('tbody', {}, group.standings.map((row) => el('tr', { class: row.advanced ? 'advanced' : '' }, [
      el('td', {}, [String(row.pos), row.advanced ? rubyEl('span', STRINGS.advanced, { class: 'advanced-mark' }) : null]),
      el('td', {}, team(teams, row.team)),
      ...[row.p, row.w, row.d, row.l, row.gf, row.ga].map((value) => el('td', {}, String(value))),
      el('td', {}, signed(row.gd)), el('td', {}, el('strong', {}, String(row.pts))),
    ]))),
  ]));
}

function groupSection(detail, teams, stage) {
  const groups = detail.groups.filter((group) => group.stage === stage);
  return el('section', { class: 'stage-section' }, [
    rubyEl('h2', stageLabel(stage, detail.year)),
    groups.map((group) => {
      const matches = detail.matches.filter((match) => match.stage === stage && match.group === group.name);
      return el('article', { class: 'group-panel' }, [
        el('h3', {}, group.name), standingsTable(group, teams),
        el('div', { class: 'match-list' }, matches.map((match) => matchLink(match, teams))),
      ]);
    }),
  ]);
}

function bracketTie(tie, detail, teams) {
  const matches = tie.matches.map((id) => detail.matches.find((match) => match.id === id));
  return el('article', { class: 'bracket-tie' }, [
    tie.teams.map((key) => el('div', { class: tie.winner === key ? 'bracket-team winner' : 'bracket-team' }, [
      team(teams, key), tie.winner === key ? text(' ✓') : null,
    ])),
    el('div', { class: 'tie-links' }, matches.map((match, index) => el('a', { href: `#/m/${match.id}` }, [
      rubyNodes(index ? STRINGS.replay : STRINGS.matchDetails), text(` ${match.score.home}–${match.score.away}`),
    ]))),
  ]);
}

function bracketSection(detail, teams) {
  const bracket = buildBracket(detail);
  const columns = detail.stages.filter((stage) => ['r32', 'r16', 'qf', 'sf', 'final'].includes(stage));
  if (!columns.length) return null;
  return el('section', { class: 'stage-section' }, [
    rubyEl('h2', STRINGS.bracket),
    el('div', { class: 'bracket-scroll', role: 'region', 'aria-label': 'bracket' },
      el('div', { class: 'bracket' }, columns.map((round) => el('section', { class: 'bracket-round' }, [
        rubyEl('h3', stageLabel(round, detail.year)),
        bracket.rounds[round].map((tie) => bracketTie(tie, detail, teams)),
      ])))),
  ]);
}

function thirdSection(detail, teams) {
  const match = detail.matches.find((item) => item.stage === 'third');
  if (!match) return null;
  return el('section', { class: 'stage-section' }, [
    rubyEl('h2', stageLabel('third', detail.year)),
    el('div', { class: 'match-list standalone-match' }, matchLink(match, teams)),
  ]);
}

export function tournamentView(detail, teams) {
  const stageViews = [];
  let bracketRendered = false;
  for (const stage of detail.stages) {
    if (['group', 'second-group', 'final-round'].includes(stage)) stageViews.push(groupSection(detail, teams, stage));
    else if (stage === 'third') stageViews.push(thirdSection(detail, teams));
    else if (!bracketRendered) {
      stageViews.push(bracketSection(detail, teams));
      bracketRendered = true;
    }
  }
  return el('article', { class: 'page tournament-page' }, [
    rubyEl('h1', tournamentTitle(detail, teams)),
    el('p', { class: 'dates' }, `${formatDate(detail.start)}〜${formatDate(detail.end)}`),
    el('section', { class: 'summary panel' }, [
      el('div', {}, [rubyEl('h2', STRINGS.host), hostList(detail, teams)]),
      el('div', { class: 'stats' }, [stat(STRINGS.teams, detail.teams), stat(STRINGS.matches, detail.matches.length), stat(STRINGS.goals, detail.goals)]),
    ]),
    el('div', { class: 'two-column' }, [podium(detail, teams), honours(detail, teams)]),
    stageViews,
  ]);
}

export function matchView(detail, match, teams) {
  const stage = match.group || stageLabel(match.stage, detail.year);
  const goals = [...match.goals].sort((a, b) => a.sort - b.sort);
  return el('article', { class: 'page match-page' }, [
    el('nav', { class: 'breadcrumb', 'aria-label': 'breadcrumb' }, [
      el('a', { href: `#/t/${detail.year}` }, rubyNodes(tournamentTitle(detail, teams))),
      text(' › '), typeof stage === 'string' && stage.includes('{') ? rubyNodes(stage) : text(stage),
    ]),
    rubyEl('h1', STRINGS.matchDetails),
    el('section', { class: 'score-card' }, [
      team(teams, match.home, 'score-team'),
      el('div', { class: 'score-centre' }, [
        el('strong', { class: 'big-score' }, `${match.score.home}–${match.score.away}`),
        el('div', { class: 'match-badges' }, scoreBadges(match)),
        match.score.ht ? el('p', {}, [rubyNodes(STRINGS.firstHalf), text(` ${match.score.ht[0]}–${match.score.ht[1]}`)]) : null,
      ]),
      team(teams, match.away, 'score-team'),
    ]),
    el('dl', { class: 'match-meta panel' }, [
      rubyEl('dt', STRINGS.date), el('dd', {}, `${formatDate(match.date)}${match.time ? ` ${match.time}` : ''}`),
      match.venue ? rubyEl('dt', STRINGS.venue) : null,
      match.venue ? el('dd', {}, `${match.venue.stadium}, ${match.venue.city}`) : null,
    ]),
    el('section', { class: 'goals-panel panel' }, [
      rubyEl('h2', STRINGS.goalTimeline),
      goals.length ? el('ol', { class: 'timeline' }, goals.map((goal) => el('li', { class: goal.team === match.home ? 'goal-home' : 'goal-away' }, [
        el('span', { class: 'goal-minute' }, formatMinute(goal.minute)),
        el('span', { class: 'person' }, playerName(detail, goal.player)),
        goal.penalty ? badge('PK') : null,
        goal.ownGoal ? badge(STRINGS.ownGoal, 'own-goal') : null,
        goal.ownGoal ? team(teams, goal.playerTeam, 'player-team') : null,
      ]))) : rubyEl('p', STRINGS.noGoals),
    ]),
    el('a', { class: 'back-link', href: `#/t/${detail.year}` }, rubyNodes(STRINGS.backTournament)),
  ]);
}

export function creditsView(meta) {
  const link = (href, label) => el('a', { href }, label);
  return el('article', { class: 'page credits-page' }, [
    rubyEl('h1', STRINGS.credits),
    rubyEl('h2', STRINGS.dataSources),
    el('section', { class: 'panel credit-block' }, [
      el('h3', {}, 'Fjelstul World Cup Database v1.2.0'),
      el('p', {}, meta.sources.fjelstul.attribution),
      el('p', {}, [link(meta.sources.fjelstul.url, 'github.com/jfjelstul/worldcup'), text(' — '), link('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0')]),
      rubyEl('p', STRINGS.modified),
    ]),
    el('section', { class: 'panel credit-block' }, [
      el('h3', {}, 'openfootball/worldcup.json'),
      el('p', {}, [link(meta.sources.openfootball.url, 'github.com/openfootball/worldcup.json'), text(' — CC0')]),
    ]),
    el('section', { class: 'panel credit-block' }, [
      el('h3', {}, 'Wikipedia'),
      el('p', {}, [text('Japanese names — '), link('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0')]),
    ]),
    el('section', { class: 'panel credit-block' }, [
      rubyEl('h3', STRINGS.flags),
      el('p', {}, 'flag-icons — MIT — © 2013 Panayiotis Lipiridis'),
      el('p', {}, [text('Historical flags — Wikimedia Commons — public domain — '), link('https://commons.wikimedia.org/', 'commons.wikimedia.org')]),
    ]),
    rubyEl('h2', STRINGS.licences),
    el('p', {}, [rubyNodes(STRINGS.siteData), text(' — '), link('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0')]),
    el('p', {}, [rubyNodes(STRINGS.code), text(' — MIT')]),
  ]);
}

export function notFoundView() {
  return el('section', { class: 'page message-page' }, [rubyEl('h1', STRINGS.pageNotFound), el('a', { class: 'back-link', href: '#/' }, rubyNodes(STRINGS.goHome))]);
}

export function errorView(retry) {
  const button = rubyEl('button', STRINGS.retry, { type: 'button', class: 'retry-button' });
  button.addEventListener('click', retry);
  return el('section', { class: 'page message-page', role: 'alert' }, [rubyEl('h1', STRINGS.dataError), button]);
}
