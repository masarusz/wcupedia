import { buildBracket } from './bracket.js?v=0.2.4';
import { bracketState, stackedBracketLayout } from './bracket-layout.js?v=0.2.4';
import { el, rubyEl, rubyNodes, text } from './dom.js?v=0.2.4';
import { formatDate, formatMinute, groupLabel, signed, tournamentTitle } from './format.js?v=0.2.4';
import { AWARD_LABELS, AWARD_ORDER, stageLabel, STRINGS } from './strings.js?v=0.2.4';
import { VERSION } from './version.js?v=0.2.4';
import { rubyPlain } from './ruby.js?v=0.2.4';

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
  const hosts = [...detail.hosts];
  const japan = hosts.indexOf('JPN');
  if (japan > 0) hosts.unshift(...hosts.splice(japan, 1));
  return el('div', { class: 'team-list' }, hosts.map((key) => team(teams, key)));
}

export function homeView(tournaments, teams) {
  const cards = [...tournaments].sort((a, b) => b.year - a.year).map((tournament) => {
    const champion = tournament.placings['1'];
    return el('a', { class: 'tournament-card', href: `#/t/${tournament.year}` }, [
      rubyEl('h2', tournamentTitle(tournament, teams)),
      el('div', { class: 'host-flags', 'aria-label': 'hosts' }, tournament.hosts.map((key) => flag(teams, key))),
      el('p', { class: 'champion' }, [text('🏆 '), rubyNodes(STRINGS.champion), text(' '), team(teams, champion)]),
      el('p', { class: 'card-count' }, [rubyNodes(STRINGS.teams), text(` ${tournament.teams}`)]),
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
  const awardRank = new Map(AWARD_ORDER.map((key, index) => [key, index]));
  const awards = [...detail.awards].sort((a, b) =>
    (awardRank.get(a.award) ?? AWARD_ORDER.length) - (awardRank.get(b.award) ?? AWARD_ORDER.length));
  const awardRows = awards.map((award) => el('li', {}, [
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

function standingsTable(group, teams, showAdvanceMark = true) {
  const headers = [STRINGS.rank, STRINGS.country, STRINGS.played, STRINGS.wins, STRINGS.draws, STRINGS.losses,
    STRINGS.goalsFor, STRINGS.goalsAgainst, STRINGS.goalDifference, STRINGS.points];
  return el('div', { class: 'table-scroll', role: 'region', 'aria-label': 'standings' }, el('table', { class: 'standings' }, [
    el('thead', {}, el('tr', {}, headers.map((label) => rubyEl('th', label, { scope: 'col' })))),
    el('tbody', {}, group.standings.map((row) => el('tr', { class: row.advanced ? 'advanced' : '' }, [
      el('td', {}, [String(row.pos), row.advanced && showAdvanceMark ? rubyEl('span', STRINGS.advanced, { class: 'advanced-mark' }) : null]),
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
        el('h3', {}, groupLabel(group.name)), standingsTable(group, teams, stage !== 'final-round'),
        el('div', { class: 'match-list' }, matches.map((match) => matchLink(match, teams))),
      ]);
    }),
  ]);
}

function bracketResult(match, index) {
  return el('span', { class: 'bracket-result' }, [
    index || match.replay ? badge(STRINGS.replay) : null,
    el('strong', {}, `${match.score.home}–${match.score.away}`),
    match.score.aet ? badge(STRINGS.extraTime) : null,
    match.score.pens ? el('span', { class: 'badge' }, `PK ${match.score.pens[0]}–${match.score.pens[1]}`) : null,
  ]);
}

function chartName(markup) {
  const name = rubyPlain(markup);
  const nameClass = [...name].length <= 7 ? 'bracket-name bracket-name-short' : 'bracket-name bracket-name-long';
  const parts = name.split('・');
  return el('span', { class: nameClass }, parts.flatMap((part, index) => [
    index ? text('・') : null,
    index ? el('wbr') : null,
    text(part),
  ]));
}

function bracketBox(box, state, detail, teams, standaloneFinal = false) {
  const matches = box.matches.map((id) => detail.matches.find((match) => match.id === id));
  const destination = matches.find((match) => match.replay) || matches.at(-1);
  const classes = [
    'bracket-box', standaloneFinal ? '' : `half-box-col-${box.column}`,
    standaloneFinal ? '' : `row-start-${box.rowStart}`,
    standaloneFinal ? '' : `row-span-${box.rowSpan}`,
    box.round === 'final' ? 'final-box' : '',
  ].filter(Boolean).join(' ');
  return el('a', { class: classes, href: `#/m/${destination.id}` }, [
    state.teams.map((key) => {
      const isWinner = state.winner === key;
      const teamClass = ['bracket-team', isWinner ? 'winner' : '', state.champion === key ? 'champion-team' : ''].filter(Boolean).join(' ');
      return el('span', { class: teamClass }, state.showTeams ? [
        flag(teams, key), chartName(teams[key].ja),
      ] : el('span', { class: 'bracket-name bracket-name-short' }, key));
    }),
    state.showScore ? el('span', { class: 'bracket-results' }, matches.map(bracketResult)) : null,
  ]);
}

function bracketHalf(half, layout, states, detail, teams, finalConnector) {
  const templateClass = `bracket-half-grid-template bracket-half-columns-${layout.halfColumnCount}`;
  return el('section', { class: `bracket-half bracket-half-${half.side}` }, [
    el('div', { class: `bracket-headings ${templateClass}` }, half.columns.map((column) =>
      rubyEl('h3', stageLabel(column.round, detail.year), {
        class: `bracket-column-heading half-box-col-${column.column}`,
      }))),
    el('div', { class: `bracket-grid ${templateClass}` }, [
      half.connectors.map((connector) => el('span', {
        class: `bracket-connector connector-${connector.side} connector-${connector.direction} half-gap-col-${connector.gapColumn} row-start-${connector.rowStart} row-span-${connector.rowSpan}`,
        role: 'presentation',
      })),
      half.boxes.map((box) => bracketBox(box, states.get(box.id), detail, teams)),
    ]),
    finalConnector ? el('span', {
      class: `bracket-half-final-leg bracket-half-final-leg-${finalConnector.side} bracket-final-column-${finalConnector.column}`,
      role: 'presentation',
    }) : null,
  ]);
}

function bracketChart(bracket, detail, teams, stepIndex) {
  const layout = stackedBracketLayout(bracket);
  const state = bracketState(bracket, stepIndex);
  const states = new Map(state.boxes.map((box) => [box.id, { ...box, champion: state.champion }]));
  if (layout.columnCount === 1) {
    return el('div', { class: 'bracket chart-cols-1' }, bracketBox(layout.final, states.get(layout.final.id), detail, teams, true));
  }
  const finalLink = (connector) => el('span', {
    class: `bracket-final-connector bracket-final-connector-${connector.side}`,
    role: 'presentation',
  });
  return el('div', { class: `bracket chart-cols-${layout.columnCount}` }, [
    bracketHalf(layout.halves[0], layout, states, detail, teams,
      layout.finalConnectors.find((connector) => connector.side === 'left')),
    finalLink(layout.finalConnectors.find((connector) => connector.side === 'left')),
    el('section', { class: 'bracket-final-stage' }, [
      rubyEl('h3', stageLabel(layout.final.round, detail.year), { class: 'bracket-column-heading' }),
      el('div', { class: 'bracket-final-grid' }, bracketBox(layout.final, states.get(layout.final.id), detail, teams, true)),
    ]),
    finalLink(layout.finalConnectors.find((connector) => connector.side === 'right')),
    bracketHalf(layout.halves[1], layout, states, detail, teams,
      layout.finalConnectors.find((connector) => connector.side === 'right')),
  ]);
}

function bracketSection(detail, teams) {
  const bracket = buildBracket(detail);
  if (!bracket.root) return null;
  const initialState = bracketState(bracket, Number.MAX_SAFE_INTEGER);
  const chartRegion = el('div', { class: 'bracket-chart-region' });
  const buttons = [STRINGS.beginning, ...initialState.rounds.map((round) => `${stageLabel(round, detail.year)}${STRINGS.afterRound}`)].map((label, index) => {
    const button = rubyEl('button', label, {
      type: 'button', class: 'bracket-state-button', 'aria-pressed': index === initialState.rounds.length ? 'true' : 'false',
    });
    button.addEventListener('click', () => {
      buttons.forEach((item, buttonIndex) => item.setAttribute('aria-pressed', buttonIndex === index ? 'true' : 'false'));
      chartRegion.replaceChildren(bracketChart(bracket, detail, teams, index));
    });
    return button;
  });
  chartRegion.append(bracketChart(bracket, detail, teams, initialState.rounds.length));
  return el('section', { class: 'stage-section' }, [
    rubyEl('h2', STRINGS.bracket),
    el('div', { class: 'bracket-state-switcher', role: 'group', 'aria-label': 'bracket state' }, buttons),
    el('div', { class: 'bracket-scroll', role: 'region', 'aria-label': 'bracket' }, chartRegion),
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
  const groupStages = new Set(['group', 'second-group', 'final-round']);
  const groupViews = detail.stages.filter((stage) => groupStages.has(stage))
    .map((stage) => groupSection(detail, teams, stage));
  const bracketView = bracketSection(detail, teams);
  const stageViews = bracketView
    ? [bracketView, thirdSection(detail, teams), ...groupViews].filter(Boolean)
    : groupViews;
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
  const stage = match.group ? groupLabel(match.group) : stageLabel(match.stage, detail.year);
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
