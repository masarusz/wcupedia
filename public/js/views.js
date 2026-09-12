import { buildBracket } from './bracket.js?v=0.5.1';
import { bracketState, stackedBracketLayout } from './bracket-layout.js?v=0.5.1';
import { el, rubyEl, rubyNodes, text } from './dom.js?v=0.5.1';
import { formatDate, formatMinute, groupLabel, playerLabel, signed, tournamentTitle } from './format.js?v=0.5.1';
import { search as runSearch } from './search.js?v=0.5.1';
import { AWARD_LABELS, AWARD_ORDER, stageLabel, STRINGS } from './strings.js?v=0.5.1';
import { VERSION } from './version.js?v=0.5.1';
import { rubyPlain } from './ruby.js?v=0.5.1';
import { rubyReading } from './ruby.js?v=0.5.1';
import { fold } from './fold.js?v=0.5.1';
import { ageInYears } from './ages.js?v=0.5.1';

function flag(teams, key) {
  return el('img', {
    class: 'flag', src: `assets/flags/${teams[key].flag}.svg?v=${VERSION}`,
    alt: '', width: '24', height: '18',
  });
}

export function teamName(markup, className = 'team-name') {
  const parts = rubyPlain(markup).split('・');
  return el('span', { class: className }, parts.flatMap((part, index) => [
    index ? text('・') : null,
    index ? el('wbr') : null,
    text(part),
  ]));
}

function team(teams, key, className = 'team') {
  return el('span', { class: className }, [flag(teams, key), teamName(teams[key].ja)]);
}

function countryLink(teams, key, className = 'country-link') {
  return el('a', { class: className, href: `#/c/${key}` }, [flag(teams, key), teamName(teams[key].ja)]);
}

export function meikanTeamKeys(detail, teams) {
  return Object.keys(detail.squads).sort((left, right) => {
    if (left === 'JPN') return -1;
    if (right === 'JPN') return 1;
    return teamReadingOrder(teams, left, right);
  });
}

function playerName(detail, id, teamKey, linked = false) {
  const person = detail.people[id];
  const label = person ? playerLabel(person, teamKey) : id;
  return linked ? el('a', { class: 'person', href: `#/p/${id}` }, label) : text(label);
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
  return el('div', { class: 'team-list' }, hosts.map((key) => countryLink(teams, key, 'country-link host-country-link')));
}

function searchResultRow(result, context) {
  const { teams, tournaments } = context;
  const typeLabels = { team: '国', player: '選手', tournament: '大会' };
  let href;
  let teamKey;
  let name;
  let hint = null;
  if (result.type === 'team') {
    const country = teams[result.id];
    href = `#/c/${result.id}`;
    teamKey = result.id;
    name = teamName(country.ja, 'search-result-name team-name');
    hint = `出場 ${country.tournaments.length}回`;
  } else if (result.type === 'player') {
    href = `#/p/${result.id}`;
    teamKey = result.team;
    name = el('span', { class: 'search-result-name person' }, playerLabel({ name: result.label, ja: result.ja }, teamKey));
    const [first, last] = result.years;
    hint = `${rubyPlain(teams[teamKey].ja)} ${first === last ? `${first}年` : `${first}–${last}年`}`;
  } else {
    const tournament = tournaments.find((item) => item.year === Number(result.id));
    href = `#/t/${result.id}`;
    teamKey = tournament.hosts[0];
    name = rubyEl('span', tournamentTitle(tournament, teams), { class: 'search-result-name' });
  }
  return el('a', { class: 'search-result', href, 'data-year': result.type === 'tournament' ? result.id : null }, [
    el('span', { class: `search-type search-type-${result.type}` }, typeLabels[result.type]),
    flag(teams, teamKey),
    name,
    hint ? el('small', { class: 'search-result-hint' }, hint) : null,
  ]);
}

export function searchComponent({ initialQuery = '', eager = false, loadContext, updateUrl }) {
  const inputId = 'site-search-input';
  const results = el('div', { class: 'search-results', 'aria-live': 'polite' });
  const input = el('input', {
    id: inputId, class: 'search-input', type: 'search', placeholder: rubyPlain(STRINGS.searchLabel),
    enterkeyhint: 'search', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  input.value = initialQuery;
  let context = null;
  let loading = null;

  const showMatches = () => {
    const query = input.value;
    if (!query) {
      results.replaceChildren();
      return;
    }
    const matches = runSearch(context.index, query);
    results.replaceChildren(matches.length
      ? el('div', { class: 'search-result-list' }, matches.map((result) => searchResultRow(result, context)))
      : rubyEl('p', STRINGS.noSearchResults, { class: 'search-status' }));
  };
  const ensureReady = async () => {
    if (context) return showMatches();
    results.replaceChildren(rubyEl('p', STRINGS.loading, { class: 'search-status' }));
    if (!loading) loading = loadContext();
    try {
      context = await loading;
      showMatches();
    } catch {
      loading = null;
      results.replaceChildren(rubyEl('p', STRINGS.dataError, { class: 'search-status' }));
    }
  };
  input.addEventListener('focus', ensureReady);
  input.addEventListener('input', () => {
    updateUrl(input.value);
    if (context) showMatches();
    else void ensureReady();
  });
  if (eager || initialQuery) void ensureReady();
  return el('section', { class: 'search-box', role: 'search' }, [
    rubyEl('label', STRINGS.searchLabel, { for: inputId }),
    input,
    results,
  ]);
}

export function homeView(tournaments, teams, searchOptions = null) {
  const cards = [...tournaments].sort((a, b) => b.year - a.year).map((tournament) => {
    const champion = tournament.placings['1'];
    return el('a', { class: 'tournament-card', href: `#/t/${tournament.year}`, 'data-year': tournament.year }, [
      rubyEl('h2', tournamentTitle(tournament, teams)),
      el('div', { class: 'host-flags', 'aria-label': 'hosts' }, tournament.hosts.map((key) => flag(teams, key))),
      el('p', { class: 'champion' }, [text('🏆 '), rubyNodes(STRINGS.champion), text(' '), team(teams, champion)]),
      el('p', { class: 'card-count' }, [rubyNodes(STRINGS.teams), text(` ${tournament.teams}`)]),
    ]);
  });
  return el('section', { class: 'page home-page' }, [
    searchOptions ? searchComponent(searchOptions) : null,
    rubyEl('h1', STRINGS.tournaments),
    rubyEl('p', STRINGS.intro, { class: 'intro' }),
    el('div', { class: 'tournament-grid' }, cards),
  ]);
}

export function searchView(searchOptions) {
  return el('section', { class: 'page search-page' }, [
    rubyEl('h1', STRINGS.search),
    searchComponent({ ...searchOptions, eager: true }),
  ]);
}

function podium(detail, teams) {
  const labels = { '1': STRINGS.champion, '2': STRINGS.runnerUp, '3': STRINGS.third, '4': STRINGS.fourth };
  const rows = Object.keys(labels).filter((place) => detail.placings[place]).map((place) =>
    el('li', { class: place === '1' ? 'podium-first' : '' }, [
      rubyEl('strong', labels[place]),
      countryLink(teams, detail.placings[place], 'country-link podium-country-link'),
    ]));
  return el('section', { class: 'panel' }, [rubyEl('h2', STRINGS.podium), el('ol', { class: 'podium' }, rows)]);
}

function honourPlayerLine(detail, playerId, playerTeamKey, teams, awardTeamKey) {
  return el('span', { class: 'honour-player' }, [
    playerName(detail, playerId, playerTeamKey, true),
    team(teams, awardTeamKey),
  ]);
}

export function awardTier(award) {
  if (award.startsWith('golden-')) return 'golden';
  if (award.startsWith('silver-')) return 'silver';
  if (award.startsWith('bronze-')) return 'bronze';
  return 'young';
}

function honours(detail, teams) {
  const scorerRows = detail.topScorers.map((scorer) => {
    const scorerGoal = detail.matches.flatMap((match) => match.goals).find((goal) => goal.player === scorer.player && !goal.ownGoal);
    return el('li', { class: 'honour-row' }, [
      honourPlayerLine(detail, scorer.player, scorerGoal.playerTeam, teams, scorerGoal.team),
      el('strong', { class: 'honour-pill honour-pill-scorer' }, [text(`${scorer.goals}`), rubyNodes(STRINGS.goals)]),
    ]);
  });
  const awardRank = new Map(AWARD_ORDER.map((key, index) => [key, index]));
  const awards = [...detail.awards].sort((a, b) =>
    (awardRank.get(a.award) ?? AWARD_ORDER.length) - (awardRank.get(b.award) ?? AWARD_ORDER.length));
  const awardRows = awards.map((award) => el('li', { class: 'honour-row' }, [
    rubyEl('strong', AWARD_LABELS[award.award] || award.award, { class: `honour-pill honour-pill-${awardTier(award.award)}` }),
    honourPlayerLine(detail, award.player, award.team, teams, award.team),
  ]));
  return el('section', { class: 'panel honours' }, [
    rubyEl('h2', STRINGS.topScorer), el('ul', {}, scorerRows),
    awardRows.length ? rubyEl('h2', STRINGS.awards) : null,
    awardRows.length ? el('ul', {}, awardRows) : null,
  ]);
}

function standingsTable(group, teams, showAdvanceMark = true) {
  const headers = ['順位', '国', '試合', '勝', '分', '敗', '得点', '失点', '差', '勝ち点'];
  return el('div', { class: 'table-scroll', role: 'region', 'aria-label': 'standings' }, el('table', { class: 'standings' }, [
    el('thead', {}, el('tr', {}, headers.map((label) => el('th', { scope: 'col' }, label)))),
    el('tbody', {}, group.standings.map((row) => el('tr', { class: row.advanced ? 'advanced' : '' }, [
      el('td', {}, [String(row.pos), row.advanced && showAdvanceMark ? rubyEl('span', STRINGS.advanced, { class: 'advanced-mark' }) : null]),
      el('td', {}, countryLink(teams, row.team, 'country-link standings-country-link')),
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
  return teamName(markup, nameClass);
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
    el('a', { class: 'meikan-entry-link', href: `#/z/${detail.year}` }, 'この大会の選手名鑑'),
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
      countryLink(teams, match.home, 'country-link score-team'),
      el('div', { class: 'score-centre' }, [
        el('strong', { class: 'big-score' }, `${match.score.home}–${match.score.away}`),
        el('div', { class: 'match-badges' }, scoreBadges(match)),
        match.score.ht ? el('p', {}, [rubyNodes(STRINGS.firstHalf), text(` ${match.score.ht[0]}–${match.score.ht[1]}`)]) : null,
      ]),
      countryLink(teams, match.away, 'country-link score-team'),
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
        playerName(detail, goal.player, goal.playerTeam, true),
        goal.penalty ? badge('PK') : null,
        goal.ownGoal ? badge(STRINGS.ownGoal, 'own-goal') : null,
        goal.ownGoal ? team(teams, goal.playerTeam, 'player-team') : null,
      ]))) : rubyEl('p', STRINGS.noGoals),
    ]),
    el('a', { class: 'back-link', href: `#/t/${detail.year}` }, rubyNodes(STRINGS.backTournament)),
  ]);
}

const REGION_SECTIONS = [
  ['AFC', 'アジア'], ['UEFA', 'ヨーロッパ'], ['CONMEBOL', '南米'],
  ['CONCACAF', '北中米カリブ'], ['CAF', 'アフリカ'], ['OFC', 'オセアニア'],
];

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const teamReadingOrder = (teams, left, right) =>
  compareText(fold(rubyReading(teams[left].ja)), fold(rubyReading(teams[right].ja))) || compareText(left, right);

export function countriesView(teams) {
  const roots = Object.keys(teams).filter((key) => !teams[key].successor);
  return el('article', { class: 'page countries-page' }, [
    el('h1', {}, '国'),
    REGION_SECTIONS.map(([region, label]) => {
      const keys = roots.filter((key) => teams[key].region === region).sort((a, b) => teamReadingOrder(teams, a, b));
      return el('section', { class: 'country-region' }, [
        el('h2', {}, label),
        el('div', { class: 'country-grid' }, keys.map((key) => el('a', { class: 'country-tile', href: `#/c/${key}` }, [
          flag(teams, key), teamName(teams[key].ja),
          teams[key].predecessors.length ? el('small', {}, `${teams[key].predecessors.map((item) => rubyPlain(teams[item].ja)).join('・')}をふくむ`) : null,
        ]))),
      ]);
    }),
  ]);
}

const FINISH_LABELS = {
  champion: '優勝', 'runner-up': '準優勝', third: '3位', fourth: '4位', sf: 'ベスト4', qf: 'ベスト8',
  r16: 'ベスト16', r32: 'ベスト32', 'second-group': '2次リーグ', 'final-round': '決勝リーグ', group: 'グループリーグ',
};

function recordStats(record) {
  return el('div', { class: 'record-stats' }, [
    ['試合', record.p], ['勝', record.w], ['分', record.d], ['敗', record.l], ['得点', record.gf], ['失点', record.ga],
  ].map(([label, value]) => el('span', {}, [el('strong', {}, String(value)), text(label)])));
}

function countryMatchLink(match, teams) {
  return el('a', { class: 'country-match-link', href: `#/m/${match.id}`, 'data-year': match.year }, [
    text(`${match.year}年 `), team(teams, match.home), el('strong', {}, `${match.homeGoals}–${match.awayGoals}`), team(teams, match.away),
  ]);
}

export function countryView(key, teams) {
  const country = teams[key];
  const predecessorNames = country.predecessors.map((item) => rubyPlain(teams[item].ja));
  const opponents = country.opponents.slice().sort((a, b) => b.p - a.p || teamReadingOrder(teams, a.team, b.team));
  const tournamentRows = [...country.tournaments].sort((a, b) => b.year - a.year);
  const meikanTournament = country.ownTournaments.at(-1) || country.tournaments.at(-1);
  return el('article', { class: 'page country-page' }, [
    el('header', { class: 'country-header panel' }, [
      flag(teams, key), teamName(country.ja, 'team-name country-title'),
      predecessorNames.length ? el('p', { class: 'lineage-note' }, `${predecessorNames.join('・')}時代をふくむ`) : null,
      el('div', { class: 'country-head-stats' }, [
        el('span', {}, `出場 ${country.tournaments.length}回`),
        el('span', {}, `最高 ${FINISH_LABELS[country.bestFinish] || '—'}`),
        el('span', {}, `優勝 ${country.titlesWithPredecessors}回`),
      ]),
      meikanTournament ? el('a', { class: 'country-meikan-link', href: `#/z/${meikanTournament.year}/${key}` }, '選手名鑑') : null,
    ]),
    el('section', { class: 'panel' }, [el('h2', {}, '通算成績'), recordStats(country.record)]),
    el('section', { class: 'panel' }, [
      el('h2', {}, '大会ごとの成績'),
      el('ul', { class: 'country-tournaments' }, tournamentRows.map((item) => el('li', { 'data-year': item.year }, [
        el('a', { href: `#/t/${item.year}` }, `${item.year}年`),
        el('strong', {}, FINISH_LABELS[item.finish] || item.finish),
        item.team !== key ? el('small', {}, `${rubyPlain(teams[item.team].ja)}時代`) : null,
      ]))),
    ]),
    el('section', { class: 'panel opponents-panel' }, [
      el('h2', {}, '対戦成績'),
      el('table', { class: 'opponents-table' }, [
        el('thead', {}, el('tr', {}, ['相手', '試合', '勝', '分', '敗'].map((label) => el('th', { scope: 'col' }, label)))),
        el('tbody', {}, opponents.map((row) => el('tr', {}, [
          el('td', {}, el('details', {}, [
            el('summary', {}, [flag(teams, row.team), teamName(teams[row.team].ja)]),
            el('div', { class: 'opponent-matches' }, [...row.matches]
              .sort((a, b) => compareText(b.date, a.date) || compareText(b.id, a.id))
              .map((match) => countryMatchLink(match, teams))),
          ])),
          ...[row.p, row.w, row.d, row.l].map((value) => el('td', {}, String(value))),
        ]))),
      ]),
    ]),
    el('section', { class: 'panel country-scorers' }, [
      el('h2', {}, '通算得点ランキング'),
      country.topScorers.length ? el('ol', {}, country.topScorers.map((row) => el('li', {}, [
        el('a', { class: 'person', href: `#/p/${row.player}` }, playerLabel(row, row.team)),
        el('strong', {}, `${row.goals}点`),
      ]))) : el('p', {}, '得点の記録はありません'),
    ]),
    country.successor || country.predecessors.length ? el('nav', { class: 'lineage-links', 'aria-label': '国の歴史' }, [
      country.successor ? el('a', { href: `#/c/${country.successor}` }, `${rubyPlain(teams[country.successor].ja)}を見る`) : null,
      country.predecessors.map((item) => el('a', { href: `#/c/${item}` }, `${rubyPlain(teams[item].ja)}を見る`)),
    ]) : null,
  ]);
}

const POSITION_LABELS = { GK: 'ゴールキーパー', DF: 'ディフェンダー', MF: 'ミッドフィールダー', FW: 'フォワード' };
const PHOTO_INTRODUCTION = '写真は Wikimedia Commons のものを、それぞれのライセンスにしたがって使っています。どの写真も、顔の部分を切り抜いて小さくしています。';

function photoCredit(photo) {
  return el('p', { class: 'photo-credit' }, [
    text('写真: '), el('a', { href: photo.source }, photo.artist), text(' / '),
    photo.licenceUrl ? el('a', { href: photo.licenceUrl }, photo.licence) : text(photo.licence),
    text('（切り抜き・縮小）'),
  ]);
}

function playerPortrait(id, label, photo, className) {
  if (!photo) return null;
  return el('figure', { class: className }, [
    el('img', { src: `assets/players/${id}.webp?v=${VERSION}`, width: 240, height: 320, alt: label }),
    el('figcaption', {}, photoCredit(photo)),
  ]);
}

export function playerView(id, player, details, suppliedTeams = null, photo = null) {
  const teams = Object.assign({}, ...details.map((detail) => detail.teamDisplay || {}), suppliedTeams || {});
  const label = playerLabel(player, player.teams.includes('JPN') ? 'JPN' : player.teams.at(-1));
  const awardRows = [...player.awards].sort((a, b) => b[0] - a[0]);
  const tournamentRows = [...details].sort((a, b) => b.year - a.year).map((detail) => {
    let squadTeam = null;
    let member = null;
    for (const [teamKey, squad] of Object.entries(detail.squads)) {
      const found = squad.find((item) => item.player === id);
      if (found) { squadTeam = teamKey; member = found; break; }
    }
    if (!member) throw new Error(`player ${id} missing from ${detail.year} squad`);
    const goals = detail.matches.flatMap((match) => match.goals
      .filter((goal) => goal.player === id)
      .map((goal) => ({ ...goal, match })));
    return el('section', { class: 'player-tournament panel', 'data-year': detail.year }, [
      el('h2', {}, [
        el('a', { href: `#/t/${detail.year}` }, rubyNodes(tournamentTitle(detail, teams))),
        player.birthDate ? el('span', { class: 'player-age' }, `${ageInYears(player.birthDate, detail.start)}さい`) : null,
      ]),
      el('p', { class: 'player-squad-line' }, [team(teams, squadTeam), text(` 背番号${member.no}・${POSITION_LABELS[member.pos] || member.pos}`)]),
      Object.hasOwn(player, 'appsByYear') ? el('p', {}, `出場試合数 ${player.appsByYear[detail.year]}試合`) : null,
      el('p', {}, `ゴール ${player.goalsByYear[detail.year] || 0}点`),
      goals.length ? el('ul', { class: 'player-goals' }, goals.map((goal) => el('li', {}, [
        el('a', { href: `#/m/${goal.match.id}` }, `${formatMinute(goal.minute)} ${rubyPlain(teams[goal.match.home].ja)} ${goal.match.score.home}–${goal.match.score.away} ${rubyPlain(teams[goal.match.away].ja)}`),
        goal.penalty ? badge('PK') : null, goal.ownGoal ? badge(STRINGS.ownGoal, 'own-goal') : null,
      ]))) : null,
    ]);
  });
  return el('article', { class: 'page player-page' }, [
    el('header', { class: 'player-header panel' }, [
      playerPortrait(id, label, photo, 'player-portrait'),
      el('div', { class: 'player-header-copy' }, [
        el('div', { class: 'player-flags' }, player.teams.map((teamKey) => flag(teams, teamKey))),
        el('h1', {}, label),
        player.birthDate ? el('p', { class: 'player-birth-date' }, `${Number(player.birthDate.slice(0, 4))}年${Number(player.birthDate.slice(5, 7))}月${Number(player.birthDate.slice(8, 10))}日うまれ`) : null,
        el('p', {}, `通算ゴール ${player.goals}点`),
        Object.hasOwn(player, 'apps') ? el('p', {}, `出場試合数 ${player.apps}試合`) :
          el('p', { class: 'appearance-note' }, '1970年より前の出場試合の記録はありません'),
      ]),
    ]),
    player.awards.length ? el('section', { class: 'panel player-awards' }, [
      el('h2', {}, '大会賞'),
      el('ul', {}, awardRows.map(([year, award]) => el('li', { 'data-year': year }, [
        rubyEl('strong', AWARD_LABELS[award] || award, { class: `honour-pill honour-pill-${awardTier(award)}` }),
        el('a', { href: `#/t/${year}` }, `${year}年`),
      ]))),
    ]) : null,
    tournamentRows,
  ]);
}

function meikanCard(detail, member, teamKey) {
  const person = detail.people[member.player];
  const label = playerLabel(person, teamKey);
  const picture = member.photo
    ? el('img', {
      class: 'meikan-photo', src: `assets/players/${member.player}.webp?v=${VERSION}`,
      loading: 'lazy', width: 240, height: 320, alt: label,
    })
    : el('div', { class: 'meikan-silhouette', 'aria-label': '写真なし' }, [
      el('span', { class: 'silhouette-person', 'aria-hidden': 'true' }, '👤'),
      el('strong', { class: 'silhouette-number' }, member.no ?? '–'),
    ]);
  return el('a', { class: 'meikan-card', href: `#/p/${member.player}` }, [
    picture,
    el('strong', { class: 'meikan-name person' }, label),
    el('span', { class: 'meikan-shirt' }, `${member.no == null ? '背番号なし' : `背番号 ${member.no}`}・${member.pos}`),
    Number.isInteger(member.age) ? el('span', { class: 'meikan-age' }, `${member.age}さい`) : null,
    member.club ? el('span', { class: 'meikan-club' }, member.club) : null,
    el('span', { class: 'meikan-career' }, [
      text(`W杯 ${member.goals}点`),
      Object.hasOwn(member, 'apps') ? text(`・${member.apps}試合`) : null,
    ]),
  ]);
}

export function meikanView(detail, teams, tournaments, selectedTeam = null) {
  const teamKeys = meikanTeamKeys(detail, teams);
  const teamKey = selectedTeam || teamKeys[0];
  const picker = el('select', { id: 'meikan-tournament', class: 'meikan-tournament-picker' },
    [...tournaments].sort((a, b) => b.year - a.year).map((tournament) =>
      el('option', { value: tournament.year, selected: tournament.year === detail.year, 'data-year': tournament.year }, `${tournament.year}年`)));
  picker.value = String(detail.year);
  picker.addEventListener('change', () => { location.hash = `#/z/${picker.value}`; });

  const grid = el('div', { class: 'meikan-grid' });
  const filterButtons = [];
  const renderCards = (position) => {
    filterButtons.forEach((button) => button.setAttribute('aria-pressed', button.getAttribute('value') === position ? 'true' : 'false'));
    const squad = detail.squads[teamKey].filter((member) => position === 'all' || member.pos === position);
    grid.replaceChildren(...squad.map((member) => meikanCard(detail, member, teamKey)));
  };
  for (const [value, label] of [['all', 'すべて'], ['GK', 'GK'], ['DF', 'DF'], ['MF', 'MF'], ['FW', 'FW']]) {
    const button = el('button', { type: 'button', value, class: 'meikan-filter', 'aria-pressed': value === 'all' ? 'true' : 'false' }, label);
    button.addEventListener('click', () => renderCards(value));
    filterButtons.push(button);
  }
  renderCards('all');
  return el('article', { class: 'page meikan-page' }, [
    el('h1', {}, '選手名鑑'),
    el('div', { class: 'meikan-controls' }, [
      el('label', { for: 'meikan-tournament' }, '大会'), picker,
      el('nav', { class: 'meikan-team-chips', 'aria-label': '国を選ぶ' }, teamKeys.map((key) =>
        el('a', { href: `#/z/${detail.year}/${key}`, 'aria-current': key === teamKey ? 'page' : null }, [flag(teams, key), teamName(teams[key].ja)]))),
      el('div', { class: 'meikan-filters', role: 'group', 'aria-label': 'ポジション' }, filterButtons),
    ]),
    el('h2', { class: 'meikan-country-heading' }, [flag(teams, teamKey), teamName(teams[teamKey].ja)]),
    grid,
  ]);
}

const COUNTRY_METRICS = [
  ['titles', '優勝回数'], ['appearances', '出場回数'], ['wins', '勝利数'], ['goals', '総得点'],
];
const PLAYER_METRICS = [
  ['goals', '通算ゴール'], ['tournamentGoals', '1大会のゴール'], ['awards', '大会賞の数'],
  ['squads', '出場大会数'], ['apps', '出場試合数'], ['youngest', '最年少'], ['oldest', '最年長'],
];

function rankingValue(kind, metric, row) {
  if (kind === 'c') {
    if (metric === 'titles') return `優勝 ${row.value}回（準優勝 ${row.runnerUp}回）`;
    if (metric === 'appearances') return `出場 ${row.value}回`;
    if (metric === 'wins') return `${row.value}勝`;
    return `${row.value}点`;
  }
  if (metric === 'goals') return `通算 ${row.value}点`;
  if (metric === 'tournamentGoals') return `${row.value}点（${row.year}年）`;
  if (metric === 'awards') return `大会賞 ${row.value}回`;
  if (metric === 'squads') return `出場大会数 ${row.value}大会`;
  if (metric === 'youngest' || metric === 'oldest') return `${row.age}さい（${row.year}年）`;
  return `出場試合数 ${row.value}試合`;
}

export function rankingsView(rankings, teams, kind = 'c', metric = 'titles') {
  const metrics = kind === 'c' ? COUNTRY_METRICS : PLAYER_METRICS;
  const rows = kind === 'c' ? rankings.countries[metric] : rankings.players[metric];
  const yearBearingMetric = kind === 'p' && ['tournamentGoals', 'youngest', 'oldest'].includes(metric);
  const displayRows = yearBearingMetric
    ? [...rows].sort((a, b) => a.rank - b.rank || b.year - a.year)
    : rows;
  const caption = kind === 'p' && metric === 'squads' ? 'メンバーに選ばれた大会の数'
    : kind === 'p' && metric === 'apps' ? '1970年から' : null;
  return el('article', { class: 'page rankings-page' }, [
    el('h1', {}, 'ランキング'),
    el('nav', { class: 'ranking-tabs', 'aria-label': 'ランキングの種類' }, [
      el('a', { href: '#/r/c/titles', 'aria-current': kind === 'c' ? 'page' : null }, '国'),
      el('a', { href: '#/r/p/goals', 'aria-current': kind === 'p' ? 'page' : null }, '選手'),
    ]),
    el('nav', { class: 'ranking-metrics', 'aria-label': 'ランキングの項目' }, metrics.map(([key, label]) =>
      el('a', { href: `#/r/${kind}/${key}`, 'aria-current': key === metric ? 'page' : null }, label))),
    caption ? el('p', { class: 'ranking-caption' }, caption) : null,
    el('ol', { class: 'ranking-list' }, displayRows.map((row) => el('li', {
      class: `ranking-row rank-${Math.min(row.rank, 4)}${kind === 'c' && row.team === 'JPN' ? ' ranking-japan' : ''}`,
      'data-year': yearBearingMetric ? row.year : null,
    }, [
      el('strong', { class: 'ranking-rank' }, String(row.rank)),
      flag(teams, row.team),
      kind === 'c'
        ? el('a', { class: 'ranking-name', href: `#/c/${row.team}` }, teamName(row.ja))
        : el('a', { class: 'ranking-name person', href: `#/p/${row.player}` }, playerLabel(row, row.team)),
      ['tournamentGoals', 'youngest', 'oldest'].includes(metric) ? el('a', { class: 'ranking-value', href: `#/t/${row.year}` }, rankingValue(kind, metric, row))
        : el('strong', { class: 'ranking-value' }, rankingValue(kind, metric, row)),
    ]))),
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
      el('h3', {}, '写真のクレジット'),
      el('p', {}, PHOTO_INTRODUCTION),
      el('a', { href: '#/credits/photos' }, '写真のクレジットを見る'),
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

export function photoCreditsView(photos) {
  return el('article', { class: 'page photo-credits-page' }, [
    el('h1', {}, '写真のクレジット'),
    el('p', {}, PHOTO_INTRODUCTION),
    el('ul', { class: 'photo-credit-list' }, Object.entries(photos).map(([id, photo]) => el('li', { class: 'photo-credit-row' }, [
      el('a', { class: 'photo-credit-player person', href: `#/p/${id}` }, playerLabel(photo, photo.team)),
      el('span', { class: 'photo-credit-details' }, [
        el('a', { href: photo.source }, photo.artist), text(' / '),
        photo.licenceUrl ? el('a', { href: photo.licenceUrl }, photo.licence) : text(photo.licence),
        text(' / '), el('a', { href: photo.source }, '出典'),
      ]),
    ]))),
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
