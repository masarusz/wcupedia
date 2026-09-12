import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rubyPlain } from '../public/js/ruby.js?v=0.5.3';
import { stageLabel } from '../public/js/strings.js?v=0.5.3';

const ROOT = resolve(import.meta.dirname, '..');
const DATA = join(ROOT, 'public/data');
const load = (path) => JSON.parse(readFileSync(join(DATA, path), 'utf8'));

class FakeNode {}

class FakeText extends FakeNode {
  constructor(value) {
    super();
    this.value = String(value);
  }

  get textContent() {
    return this.value;
  }

  set textContent(value) {
    this.value = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this.classList = {
      toggle: (name, force) => {
        const names = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !names.has(name) : Boolean(force);
        if (enabled) names.add(name);
        else names.delete(name);
        this.setAttribute('class', [...names].join(' '));
        return enabled;
      },
    };
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  append(...children) {
    for (const child of children) {
      this.childNodes.push(child instanceof FakeNode ? child : new FakeText(child));
    }
  }

  replaceChildren(...children) {
    this.childNodes = [];
    this.append(...children);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren(new FakeText(value));
  }
}

function descendants(node) {
  const found = [];
  if (node instanceof FakeElement) {
    found.push(node);
    for (const child of node.childNodes) found.push(...descendants(child));
  }
  return found;
}

function hasClass(node, name) {
  return (node.getAttribute('class') || '').split(/\s+/).includes(name);
}

function renderedAwardKeys(tree) {
  const labels = [
    ['golden-ball', 'ゴールデンボール'],
    ['silver-ball', 'シルバーボール'],
    ['bronze-ball', 'ブロンズボール'],
    ['golden-boot', 'ゴールデンブーツ'],
    ['silver-boot', 'シルバーブーツ'],
    ['bronze-boot', 'ブロンズブーツ'],
    ['golden-glove', 'ゴールデングローブ'],
    ['best-young-player', '最優秀若手選手'],
  ];
  const honours = descendants(tree).find((node) => hasClass(node, 'honours'));
  const lists = honours.childNodes.filter((node) => node instanceof FakeElement && node.tagName === 'UL');
  return lists.at(-1).childNodes.map((row) => {
    const label = row.childNodes.find((node) => node instanceof FakeElement && node.tagName === 'STRONG').textContent;
    return labels.find(([, japanese]) => label.startsWith(japanese))?.[0] || label;
  });
}

export function register(test, equal, deepEqual) {
  test('rendered shell has no toggle button', async () => {
    const previousDocument = globalThis.document;
    const previousNode = globalThis.Node;
    const previousWindow = globalThis.window;
    const previousLocation = globalThis.location;
    const previousHistory = globalThis.history;
    const previousFetch = globalThis.fetch;
    const appRoot = new FakeElement('div');
    const listeners = new Map();
    const requested = [];
    globalThis.Node = FakeNode;
    globalThis.document = {
      createElement: (tagName) => new FakeElement(tagName),
      createTextNode: (value) => new FakeText(value),
      querySelector: (selector) => selector === '#app' ? appRoot : null,
    };
    globalThis.window = { addEventListener: (type, listener) => listeners.set(type, listener), scrollTo: () => {} };
    globalThis.location = { hash: '' };
    globalThis.history = {
      state: null,
      backCalls: 0,
      replaceState(state, _title, url) {
        this.state = state;
        if (url) globalThis.location.hash = url;
      },
      back() { this.backCalls += 1; },
    };
    globalThis.fetch = async (url) => {
      requested.push(String(url).split('?')[0]);
      return { ok: true, json: async () => load(String(url).split('?')[0].replace(/^data\//, '')) };
    };

    try {
      await import(`../public/js/app.js?shell-test=${Date.now()}`);
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      equal(requested.includes('data/search.json'), false, 'home does not load search before focus');
      deepEqual(descendants(appRoot).filter((node) => node.tagName === 'NAV' && node.getAttribute('aria-label') === 'main')[0]
        .childNodes.map((node) => node.textContent), ['大会', '国', '選手名鑑', 'ランキング', '検索', 'クレジット'], 'menu order');
      equal(descendants(appRoot).some((node) => node.tagName === 'BUTTON'), false, 'shell buttons');
      equal(descendants(appRoot).some((node) => node.tagName === 'RUBY' || node.tagName === 'RT'), false,
        'shell ruby or rt elements');
      equal(descendants(appRoot).find((node) => hasClass(node, 'subtitle')).textContent, 'Wカップ大図鑑',
        'home title without reading');

      const brand = descendants(appRoot).find((node) => hasClass(node, 'brand'));
      const marks = descendants(appRoot).filter((node) => hasClass(node, 'brand-mark'));
      equal(marks.length, 1, 'exactly one .brand-mark image');
      equal(marks[0].tagName, 'IMG', 'brand-mark is an img element');
      equal(brand.childNodes[0], marks[0], 'brand-mark is the first child of .brand');
      equal(marks[0].getAttribute('alt'), '', 'brand-mark has empty alt text');
      equal(marks[0].getAttribute('src'), 'assets/ball-mark.png?v=0.5.3', 'brand-mark versioned resource');
      equal(marks[0].getAttribute('width'), '34', 'brand-mark width');
      equal(marks[0].getAttribute('height'), '34', 'brand-mark height');
      requested.length = 0;
      for (const hash of ['#/c', '#/c/JPN', '#/r', '#/r/p/goals', '#/r/p/youngest', '#/r/p/oldest', '#/credits', '#/missing']) {
        globalThis.location.hash = hash;
        globalThis.history.state = null;
        await listeners.get('hashchange')();
        const headerBack = descendants(appRoot).filter((node) => hasClass(node, 'header-back'));
        equal(headerBack.length, 1, `${hash} header back count`);
        equal(headerBack[0].textContent, '‹ もどる', `${hash} header back label`);
      }
      const navigatedBack = descendants(appRoot).find((node) => hasClass(node, 'header-back'));
      navigatedBack.listeners.get('click')[0]();
      equal(globalThis.history.backCalls, 1, 'header back uses history after in-app navigation');
      equal(requested.some((path) => path.endsWith('players.json') || path.endsWith('search.json')), false,
        `country/ranking loader requests: ${requested.join(', ')}`);
      requested.length = 0;
      globalThis.location.hash = '#/z/2022/JPN';
      globalThis.history.state = null;
      await listeners.get('hashchange')();
      equal(descendants(appRoot).filter((node) => hasClass(node, 'meikan-card')).length, load('t/2022.json').squads.JPN.length,
        'player guide route cards');
      equal(requested.includes('data/players.json'), false, 'player guide does not load players.json');
      equal(requested.includes('data/search.json'), false, 'player guide does not load search.json');
      requested.length = 0;
      globalThis.location.hash = '#/p/P-14758';
      globalThis.history.state = null;
      await listeners.get('hashchange')();
      equal(descendants(appRoot).filter((node) => hasClass(node, 'header-back')).length, 1, 'player header back');
      equal(requested.includes('data/players.json'), true, 'player route loads players.json');
      equal(requested.includes('data/photos.json'), true, 'player route loads photo credits');
      deepEqual(requested.filter((path) => path.startsWith('data/t/')).sort(),
        [2006, 2010, 2014, 2018, 2026].map((year) => `data/t/${year}.json`), 'player route uncached tournament requests');
      equal(requested.includes('data/search.json'), false, 'player route does not load search.json');
      requested.length = 0;
      for (const hash of ['#/t/2022', '#/m/M-2022-64']) {
        globalThis.location.hash = hash;
        globalThis.history.state = null;
        await listeners.get('hashchange')();
        equal(descendants(appRoot).filter((node) => hasClass(node, 'header-back')).length, 1, `${hash} header back`);
      }
      equal(requested.includes('data/search.json'), false, 'tournament/match routes do not load search.json');
      globalThis.location.hash = '#/';
      globalThis.history.state = null;
      await listeners.get('hashchange')();
      equal(descendants(appRoot).some((node) => hasClass(node, 'header-back')), false, 'home has no back button');
      requested.length = 0;
      const homeInput = descendants(appRoot).find((node) => node.tagName === 'INPUT');
      await homeInput.listeners.get('focus')[0]();
      equal(requested.includes('data/search.json'), true, 'home focus loads search.json');
      globalThis.location.hash = '#/s?q=%E3%82%81%E3%81%A3%E3%81%97';
      globalThis.history.state = null;
      await listeners.get('hashchange')();
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      const routeInput = descendants(appRoot).find((node) => node.tagName === 'INPUT');
      equal(descendants(appRoot).filter((node) => hasClass(node, 'header-back')).length, 1, 'search header back');
      equal(routeInput.value, 'めっし', 'search route restores query');
      equal(descendants(appRoot).some((node) => node.getAttribute('href') === '#/p/P-14758'), true, 'search route restores results');
      const visitState = globalThis.history.state;
      routeInput.value = 'ぺれ';
      routeInput.listeners.get('input')[0]();
      equal(globalThis.history.state, visitState, 'search replaceState preserves visit state object');
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node;
      else globalThis.Node = previousNode;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
      if (previousHistory === undefined) delete globalThis.history;
      else globalThis.history = previousHistory;
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
    }
  });

  test('real views render every tournament and match', async () => {
    const previousDocument = globalThis.document;
    const previousNode = globalThis.Node;
    globalThis.Node = FakeNode;
    globalThis.document = {
      createElement: (tagName) => new FakeElement(tagName),
      createTextNode: (value) => new FakeText(value),
    };

    try {
      const { countriesView, countryView, creditsView, errorView, homeView, matchView, meikanTeamKeys, meikanView, notFoundView,
        photoCreditsView, playerView, rankingsView, teamName, tournamentView } =
        await import('../public/js/views.js?v=0.5.3');
      const tournaments = load('tournaments.json');
      const teams = load('teams.json');
      const players = load('players.json');
      const rankings = load('rankings.json');
      const meta = load('meta.json');
      const photos = load('photos.json');
      const details = tournaments.map(({ year }) => load(`t/${year}.json`));
      const errors = [];
      const englishGroupLabels = [];
      let tournamentRenders = 0;
      let matchRenders = 0;
      let bracketStateRenders = 0;
      let meikanRenders = 0;
      let missingAlt = 0;
      let readingElementCount = 0;
      const readingElementSamples = [];
      const renderedPlayerLabels = [];
      const nestedLinks = [];
      const assertRecentFirst = (nodes, label) => {
        const years = nodes.map((node) => Number(node.getAttribute('data-year')));
        equal(years.every((year, index) => index === 0 || years[index - 1] >= year), true,
          `${label}: ${years.join(',')}`);
        return years;
      };

      const render = (label, view) => {
        try {
          const tree = view();
          missingAlt += descendants(tree).filter((node) => node.tagName === 'IMG' && !node.hasAttribute('alt')).length;
          const readingElements = descendants(tree).filter((node) => node.tagName === 'RUBY' || node.tagName === 'RT');
          readingElementCount += readingElements.length;
          if (readingElementSamples.length < 3) {
            readingElementSamples.push(...readingElements.slice(0, 3 - readingElementSamples.length)
              .map((node) => `${label}: ${node.tagName.toLowerCase()}`));
          }
          for (const link of descendants(tree).filter((node) => node.tagName === 'A')) {
            if (descendants(link).slice(1).some((node) => node.tagName === 'A')) nestedLinks.push(`${label}: ${link.getAttribute('href')}`);
          }
          return tree;
        } catch (error) {
          errors.push(`${label}: ${error.message}`);
          return null;
        }
      };

      const homeTree = render('home', () => homeView(tournaments, teams));
      const homeTournamentCards = descendants(homeTree).filter((node) => hasClass(node, 'tournament-card'));
      deepEqual(assertRecentFirst(homeTournamentCards, 'home tournaments'),
        tournaments.map(({ year }) => year).sort((a, b) => b - a), 'home tournament years');
      let tournament1950Tree;
      let tournament2022Tree;
      let tournament2026Tree;
      let canadaMoroccoTree;
      let replayTieVerified = false;
      let shootoutVerified = false;
      for (const detail of details) {
        const tree = render(`tournament ${detail.year}`, () => tournamentView(detail, teams));
        if (tree) tournamentRenders += 1;
        renderedPlayerLabels.push(...descendants(tree).filter((node) => hasClass(node, 'person')).map((node) => node.textContent));
        const knockoutRounds = detail.stages.filter((stage) => ['r32', 'r16', 'qf', 'sf', 'final'].includes(stage));
        const chart = descendants(tree).find((node) => hasClass(node, 'bracket'));
        equal(Boolean(chart), knockoutRounds.length > 0, `${detail.year} chart presence`);
        const honoursSection = descendants(tree).find((node) => hasClass(node, 'honours'));
        const honoursLists = honoursSection.childNodes.filter((node) => node instanceof FakeElement && node.tagName === 'UL');
        const scorerRowEls = honoursLists[0].childNodes.filter((node) => node instanceof FakeElement);
        const awardRowEls = (honoursLists[1]?.childNodes || []).filter((node) => node instanceof FakeElement);
        for (const row of scorerRowEls) {
          const pills = descendants(row).filter((node) => hasClass(node, 'honour-pill-scorer'));
          const playerEls = row.childNodes.filter((node) => node instanceof FakeElement && hasClass(node, 'honour-player'));
          equal(pills.length, 1, `${detail.year} scorer row goal pill`);
          equal(playerEls.length, 1, `${detail.year} scorer row player element`);
          equal(descendants(playerEls[0]).includes(pills[0]), false, `${detail.year} scorer pill nested in player`);
        }
        for (const row of awardRowEls) {
          const tierPills = descendants(row).filter((node) =>
            (node.getAttribute('class') || '').split(/\s+/).some((cls) => /^honour-pill-(golden|silver|bronze|young)$/.test(cls)));
          const playerEls = row.childNodes.filter((node) => node instanceof FakeElement && hasClass(node, 'honour-player'));
          equal(tierPills.length, 1, `${detail.year} award row tier label`);
          equal(playerEls.length, 1, `${detail.year} award row player element`);
          equal(descendants(playerEls[0]).includes(tierPills[0]), false, `${detail.year} award label nested in player`);
          equal(playerEls[0].textContent.includes(tierPills[0].textContent), false, `${detail.year} award label text leaked into player text`);
        }
        const stageSections = tree.childNodes.filter((node) =>
          node instanceof FakeElement && hasClass(node, 'stage-section'));
        const groupSections = stageSections.filter((node) =>
          descendants(node).some((descendant) => hasClass(descendant, 'group-panel')));
        const groupStages = detail.stages.filter((stage) => ['group', 'second-group', 'final-round'].includes(stage));
        deepEqual(groupSections.map((section) => section.childNodes.find((node) =>
          node instanceof FakeElement && node.tagName === 'H2').textContent),
        groupStages.map((stage) => rubyPlain(stageLabel(stage, detail.year))), `${detail.year} group stage DOM order`);
        const chartSectionIndex = stageSections.findIndex((section) =>
          descendants(section).some((node) => hasClass(node, 'bracket-chart-region')));
        const thirdSectionIndex = stageSections.findIndex((section) =>
          descendants(section).some((node) => hasClass(node, 'standalone-match')));
        const firstGroupIndex = stageSections.indexOf(groupSections[0]);
        const hasThirdPlace = detail.matches.some((match) => match.stage === 'third');
        equal(chartSectionIndex >= 0, Boolean(chart), `${detail.year} chart stage section`);
        equal(thirdSectionIndex >= 0, hasThirdPlace, `${detail.year} third-place section`);
        if (chart && firstGroupIndex >= 0) {
          equal(chartSectionIndex < firstGroupIndex, true, `${detail.year} chart before group stages`);
          if (hasThirdPlace) equal(thirdSectionIndex < firstGroupIndex, true, `${detail.year} third place before group stages`);
        }
        if (hasThirdPlace) equal(thirdSectionIndex, chartSectionIndex + 1, `${detail.year} third place directly below chart`);
        if (chart) {
          const stateButtons = descendants(tree).filter((node) => hasClass(node, 'bracket-state-button'));
          equal(stateButtons.length, knockoutRounds.length + 1, `${detail.year} state button count`);
          equal(stateButtons.at(-1).getAttribute('aria-pressed'), 'true', `${detail.year} default final state`);
          const defaultBoxes = descendants(chart).filter((node) => hasClass(node, 'bracket-box'));
          equal(descendants(chart).filter((node) => hasClass(node, 'bracket-winner-mark')).length, 0,
            `${detail.year} has no redundant winner marks`);
          equal(descendants(chart).filter((node) => hasClass(node, 'final-box')).length, 1,
            `${detail.year} one shared final`);
          equal(/^bracket chart-cols-(?:1|3|5|7|9)$/.test(chart.getAttribute('class') || ''), true,
            `${detail.year} CSS-selectable chart class`);
          equal(defaultBoxes.every((node) => /^#\/m\/M-/.test(node.getAttribute('href') || '')), true,
            `${detail.year} box match links`);
          equal(descendants(chart).filter((node) => hasClass(node, 'bracket-results')).length, defaultBoxes.length,
            `${detail.year} default scored boxes`);
          if (detail.year === 1934) {
            const replayBox = defaultBoxes.find((node) => node.getAttribute('href') === '#/m/M-1934-13');
            equal(Boolean(replayBox), true, '1934 replay destination');
            equal(descendants(replayBox).filter((node) => hasClass(node, 'bracket-result')).length, 2, '1934 both replay scores');
            replayTieVerified = true;
          }
          if (detail.year === 2022) shootoutVerified = chart.textContent.includes('PK 4–2');
          for (let stateIndex = 0; stateIndex < stateButtons.length; stateIndex += 1) {
            try {
              stateButtons[stateIndex].listeners.get('click')[0]();
              const currentChart = descendants(tree).find((node) => hasClass(node, 'bracket'));
              equal(descendants(currentChart).filter((node) => hasClass(node, 'bracket-box')).length, defaultBoxes.length,
                `${detail.year} state ${stateIndex} box count`);
              equal(descendants(currentChart).filter((node) => hasClass(node, 'final-box')).length, 1,
                `${detail.year} state ${stateIndex} final count`);
              bracketStateRenders += 1;
            } catch (error) {
              errors.push(`tournament ${detail.year} state ${stateIndex}: ${error.message}`);
            }
          }
          try {
            stateButtons[0].listeners.get('click')[0]();
          } catch (error) {
            errors.push(`tournament ${detail.year} beginning state: ${error.message}`);
          }
          equal(stateButtons[0].getAttribute('aria-pressed'), 'true', `${detail.year} beginning selected`);
          equal(descendants(tree).filter((node) => hasClass(node, 'bracket-results')).length, 0,
            `${detail.year} beginning score count`);
        }
        for (const panel of descendants(tree).filter((node) => hasClass(node, 'group-panel'))) {
          const heading = panel.childNodes.find((node) => node instanceof FakeElement && node.tagName === 'H3');
          if (heading.textContent.includes('Group ')) englishGroupLabels.push(`tournament ${detail.year}: ${heading.textContent}`);
          const table = descendants(panel).find((node) => hasClass(node, 'standings'));
          deepEqual(descendants(table).filter((node) => node.tagName === 'TH').map((node) => node.textContent),
            ['順位', '国', '試合', '勝', '分', '敗', '得点', '失点', '差', '勝ち点'], `${detail.year} standings headers`);
        }
        const hostLinks = descendants(tree).filter((node) => hasClass(node, 'host-country-link'));
        deepEqual(hostLinks.map((node) => node.getAttribute('href')), detail.hosts.slice().sort((a, b) => a === 'JPN' ? -1 : b === 'JPN' ? 1 : 0)
          .map((key) => `#/c/${key}`), `${detail.year} host country links`);
        const podiumLinks = descendants(tree).filter((node) => hasClass(node, 'podium-country-link'));
        deepEqual(podiumLinks.map((node) => node.getAttribute('href')),
          Object.values(detail.placings).filter(Boolean).map((key) => `#/c/${key}`), `${detail.year} podium country links`);
        const standingLinks = descendants(tree).filter((node) => hasClass(node, 'standings-country-link'));
        equal(standingLinks.length, detail.groups.reduce((sum, group) => sum + group.standings.length, 0), `${detail.year} standings country link count`);
        equal(standingLinks.every((node) => /^#\/c\/[A-Z]{3}$/.test(node.getAttribute('href') || '')), true, `${detail.year} standings country targets`);
        equal(descendants(tree).some((node) => node.getAttribute('href') === `#/z/${detail.year}`), true, `${detail.year} player-guide link`);
        const guideTeams = meikanTeamKeys(detail, teams);
        if (guideTeams.includes('JPN')) equal(guideTeams[0], 'JPN', `${detail.year} Japan first`);
        for (const teamKey of guideTeams) {
          const guide = render(`meikan ${detail.year} ${teamKey}`, () => meikanView(detail, teams, tournaments, teamKey));
          if (!guide) continue;
          meikanRenders += 1;
          const pickerOptions = descendants(guide).filter((node) => node.tagName === 'OPTION');
          assertRecentFirst(pickerOptions, `${detail.year} ${teamKey} player-guide picker`);
          equal(pickerOptions[0].getAttribute('value'), '2026', `${detail.year} ${teamKey} player-guide newest option`);
          const cards = descendants(guide).filter((node) => hasClass(node, 'meikan-card'));
          const squad = detail.squads[teamKey];
          equal(cards.length, squad.length, `${detail.year} ${teamKey} card count`);
          deepEqual(cards.map((card) => card.getAttribute('href')), squad.map((member) => `#/p/${member.player}`),
            `${detail.year} ${teamKey} card links`);
          equal(cards.every((card) => Boolean(players[card.getAttribute('href').slice(4)])), true,
            `${detail.year} ${teamKey} card targets`);
          const images = descendants(guide).filter((node) => hasClass(node, 'meikan-photo'));
          deepEqual(images.map((image) => image.getAttribute('src').match(/players\/(.+)\.webp/)[1]),
            squad.filter((member) => member.photo).map((member) => member.player), `${detail.year} ${teamKey} guide images`);
          equal(images.every((image) => image.getAttribute('loading') === 'lazy'
            && image.getAttribute('width') === '240' && image.getAttribute('height') === '320' && image.getAttribute('alt')), true,
          `${detail.year} ${teamKey} lazy image attributes`);
          const chips = descendants(guide).find((node) => hasClass(node, 'meikan-team-chips'));
          const filters = descendants(guide).filter((node) => hasClass(node, 'meikan-filter'));
          filters.find((button) => button.getAttribute('value') === 'MF').listeners.get('click')[0]();
          equal(descendants(guide).find((node) => hasClass(node, 'meikan-team-chips')), chips,
            `${detail.year} ${teamKey} position filter preserves chips`);
        }
        if (detail.year === 1950) tournament1950Tree = tree;
        if (detail.year === 2022) tournament2022Tree = tree;
        if (detail.year === 2026) tournament2026Tree = tree;

        for (const match of detail.matches) {
          const matchTree = render(`match ${match.id}`, () => matchView(detail, match, teams));
          if (matchTree) matchRenders += 1;
          renderedPlayerLabels.push(...descendants(matchTree).filter((node) => hasClass(node, 'person')).map((node) => node.textContent));
          const breadcrumb = descendants(matchTree).find((node) => hasClass(node, 'breadcrumb'));
          deepEqual(descendants(matchTree).filter((node) => hasClass(node, 'score-team')).map((node) => node.getAttribute('href')),
            [`#/c/${match.home}`, `#/c/${match.away}`], `${match.id} score country links`);
          if (breadcrumb.textContent.includes('Group ')) englishGroupLabels.push(`match ${match.id}: ${breadcrumb.textContent}`);
          if (detail.year === 2022 && match.home === 'CAN' && match.away === 'MAR') canadaMoroccoTree = matchTree;
        }
      }
      const creditsTree = render('credits', () => creditsView(meta));
      const photoIntroduction = '写真は Wikimedia Commons のものを、それぞれのライセンスにしたがって使っています。どの写真も、顔の部分を切り抜いて小さくしています。';
      equal(descendants(creditsTree).some((node) => node.getAttribute('href') === '#/credits/photos'), true, 'photo credits route link');
      equal(creditsTree.textContent.includes(photoIntroduction), true, 'main credits photo introduction');
      const photoCreditsTree = render('photo credits', () => photoCreditsView(photos));
      equal(photoCreditsTree.textContent.includes(photoIntroduction), true, 'photo credits introduction');
      equal(descendants(photoCreditsTree).filter((node) => hasClass(node, 'photo-credit-row')).length,
        Object.keys(photos).length, 'every photo credited');
      render('not found', () => notFoundView());
      render('error', () => errorView(() => {}));

      const countriesTree = render('countries', () => countriesView(teams));
      const rootCountries = Object.keys(teams).filter((key) => !teams[key].successor);
      equal(descendants(countriesTree).filter((node) => hasClass(node, 'country-tile')).length, 84, 'country root tile count');
      for (const key of Object.keys(teams)) {
        const tree = render(`country ${key}`, () => countryView(key, teams));
        const recent = teams[key].ownTournaments.at(-1) || teams[key].tournaments.at(-1);
        equal(descendants(tree).some((node) => node.getAttribute('href') === `#/z/${recent.year}/${key}`), true, `${key} player-guide link`);
        const tournamentList = descendants(tree).find((node) => hasClass(node, 'country-tournaments'));
        const tournamentRows = tournamentList.childNodes.filter((node) => node instanceof FakeElement);
        equal(tournamentRows.length, teams[key].tournaments.length, `${key} tournament rows including predecessors`);
        assertRecentFirst(tournamentRows, `${key} country tournaments`);
        for (const matchList of descendants(tree).filter((node) => hasClass(node, 'opponent-matches'))) {
          const links = matchList.childNodes.filter((node) => node instanceof FakeElement);
          assertRecentFirst(links, `${key} opponent matches`);
          const ids = links.map((node) => node.getAttribute('href').slice(4));
          const sourceRow = teams[key].opponents.find((row) => row.matches.length === ids.length
            && row.matches.every((match) => ids.includes(match.id)));
          const expectedIds = [...sourceRow.matches].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
            .map((match) => match.id);
          deepEqual(ids, expectedIds, `${key} opponent matches by date then id`);
        }
      }
      let rankingRenders = 0;
      for (const [kind, metrics] of [['c', ['titles', 'appearances', 'wins', 'goals']], ['p', ['goals', 'tournamentGoals', 'awards', 'squads', 'apps', 'youngest', 'oldest']]]) {
        for (const metric of metrics) {
          const tree = render(`ranking ${kind}/${metric}`, () => rankingsView(rankings, teams, kind, metric));
          rankingRenders += Boolean(tree);
          equal(descendants(tree).filter((node) => node.getAttribute('aria-current') === 'page').length, 2, `${kind}/${metric} active choices`);
          const yearRows = descendants(tree).filter((node) => hasClass(node, 'ranking-row') && node.hasAttribute('data-year'));
          for (let index = 1; index < yearRows.length; index += 1) {
            const previousRank = descendants(yearRows[index - 1]).find((node) => hasClass(node, 'ranking-rank')).textContent;
            const rank = descendants(yearRows[index]).find((node) => hasClass(node, 'ranking-rank')).textContent;
            if (rank === previousRank) equal(Number(yearRows[index - 1].getAttribute('data-year')) >= Number(yearRows[index].getAttribute('data-year')),
              true, `${kind}/${metric} rank ${rank} recent first`);
          }
        }
      }
      let playerRenders = 0;
      const [manifestPhotoPlayerId] = Object.keys(JSON.parse(readFileSync(join(ROOT, 'curated/photos.json'), 'utf8')));
      for (const [id, player] of Object.entries(players)) {
        const playerDetails = player.years.map((year) => details.find((detail) => detail.year === year));
        const tree = render(`player ${id}`, () => playerView(id, player, playerDetails, teams, photos[id] || null));
        playerRenders += Boolean(tree);
        assertRecentFirst(descendants(tree).filter((node) => hasClass(node, 'player-tournament')), `${id} World Cups`);
        const playerAwards = descendants(tree).find((node) => hasClass(node, 'player-awards'));
        if (playerAwards) assertRecentFirst(descendants(playerAwards).filter((node) => node.tagName === 'LI'), `${id} awards`);
        const portraits = descendants(tree).filter((node) => hasClass(node, 'player-portrait'));
        equal(portraits.length, photos[id] ? 1 : 0, `${id} portrait availability`);
        if (photos[id]) {
          equal(descendants(portraits[0]).filter((node) => node.tagName === 'IMG').length, 1, `${id} portrait image`);
          equal(portraits[0].textContent.includes(`写真: ${photos[id].artist} / ${photos[id].licence}（切り抜き・縮小）`), true, `${id} photo credit`);
          if (id === manifestPhotoPlayerId) equal(portraits[0].textContent.includes('（切り抜き・縮小）'), true,
            `${id} manifest photo modification note`);
        }
        if (!Object.hasOwn(player, 'apps')) {
          equal((tree.textContent.match(/1970年より前の出場試合の記録はありません/g) || []).length, 1, `${id} pre-1970 note`);
          equal(/出場試合数 \d/.test(tree.textContent), false, `${id} no partial appearance count`);
        }
        if (!player.birthDate) {
          equal(descendants(tree).some((node) => hasClass(node, 'player-birth-date') || hasClass(node, 'player-age')), false, `${id} no unknown birth date or age`);
        } else {
          equal(descendants(tree).filter((node) => hasClass(node, 'player-birth-date')).length, 1, `${id} birth date shown once`);
          equal(descendants(tree).filter((node) => hasClass(node, 'player-age')).length, player.years.length, `${id} tournament ages`);
        }
        if (id === 'P-14758') {
          const headings = descendants(tree).filter((node) => hasClass(node, 'player-tournament')).map((node) => {
            const heading = node.childNodes.find((child) => child instanceof FakeElement && child.tagName === 'H2');
            const tournamentLink = descendants(heading).find((child) => child.tagName === 'A');
            return { href: tournamentLink.getAttribute('href'), text: heading.textContent };
          });
          deepEqual(headings.map(({ href }) => Number(href.slice(-4))),
            [2026, 2022, 2018, 2014, 2010, 2006], 'Messi World Cups descending');
          const awards = descendants(playerAwards).filter((node) => node.tagName === 'LI');
          deepEqual(awards.map((node) => Number(node.getAttribute('data-year'))),
            [2026, 2026, 2022, 2022, 2014], 'Messi awards descending');
          deepEqual(awards.map((node) => descendants(node).find((child) => child.tagName === 'STRONG').textContent),
            ['シルバーボール', 'シルバーブーツ', 'ゴールデンボール', 'シルバーブーツ', 'ゴールデンボール'],
            'Messi award order within each year');
          equal(headings.find(({ href }) => href === '#/t/2018').text.includes('2018年 ロシア大会'), true,
            'Messi 2018 tournament heading includes full title');
          equal(['2026年', 'アメリカ', 'カナダ', 'メキシコ'].every((part) =>
            headings.find(({ href }) => href === '#/t/2026').text.includes(part)), true,
          'Messi 2026 tournament heading includes year and every host');
        }
      }
      equal(playerRenders, Object.keys(players).length, 'all player pages rendered');
      equal(rankingRenders, 11, 'all ranking views rendered');
      equal(rootCountries.length, 84, 'country list roots');
      for (const name of ['ボスニア・ヘルツェゴビナ', 'セルビア・モンテネグロ']) {
        const markup = teamName(name);
        equal(descendants(markup).filter((node) => node.tagName === 'WBR').length, 1, `${name} break opportunity`);
        equal(markup.textContent, name, `${name} text preserved`);
      }

      console.log(`views render counts: tournaments=${tournamentRenders} matches=${matchRenders} meikan=${meikanRenders} countries=${Object.keys(teams).length} rankings=${rankingRenders} players=${playerRenders} bracket-states=${bracketStateRenders} exceptions=${errors.length}`);
      if (errors.length) throw new Error(`render exceptions: ${errors.slice(0, 3).join('; ')}`);
      equal(tournamentRenders, 23, 'tournament render count');
      equal(matchRenders, 1068, 'match render count');
      equal(meikanRenders, details.reduce((sum, detail) => sum + Object.keys(detail.squads).length, 0), 'all tournament-country guides rendered');
      equal(bracketStateRenders > 0, true, 'all available bracket states rendered');
      equal(missingAlt, 0, 'images missing alt');
      equal(readingElementCount, 0, `ruby or rt elements rendered: ${readingElementSamples.join(', ')}`);
      equal(nestedLinks.length, 0, `nested links: ${nestedLinks.slice(0, 3).join('; ')}`);
      for (const [id, expected] of [['P-14758', 'リオネル メッシ (Lionel Messi)'], ['P-33175', '本田圭佑']]) {
        const references = details.reduce((count, detail) => count
          + detail.matches.flatMap((match) => match.goals).filter((goal) => goal.player === id).length
          + detail.topScorers.filter((item) => item.player === id).length
          + detail.awards.filter((item) => item.player === id).length, 0);
        equal(references > 0, true, `${id} render references`);
        equal(renderedPlayerLabels.filter((label) => label === expected).length, references, `${id} rendered labels`);
      }
      equal(renderedPlayerLabels.some((label) => label.includes('()') || label.includes('( )')), false, 'empty player-name parentheses');
      for (const detail of details) {
        const tournamentTree = tournamentView(detail, teams);
        const expected = detail.topScorers.length + detail.awards.length;
        equal(descendants(tournamentTree).filter((node) => node.tagName === 'A' && /^#\/p\//.test(node.getAttribute('href') || '')).length >= expected,
          true, `${detail.year} tournament player links`);
        for (const match of detail.matches) {
          const matchTree = matchView(detail, match, teams);
          equal(descendants(matchTree).filter((node) => node.tagName === 'A' && /^#\/p\//.test(node.getAttribute('href') || '')).length,
            match.goals.length, `${match.id} goal player links`);
        }
      }
      const japanTree = countryView('JPN', teams);
      equal(descendants(japanTree).some((node) => node.tagName === 'A' && /^#\/p\//.test(node.getAttribute('href') || '')), true, 'country scorer player links');
      const japanTournamentRows = descendants(japanTree).find((node) => hasClass(node, 'country-tournaments')).childNodes
        .filter((node) => node instanceof FakeElement);
      equal(japanTournamentRows[0].getAttribute('data-year'), '2026', 'Japan newest tournament first');
      equal(japanTournamentRows.at(-1).getAttribute('data-year'), '1998', 'Japan oldest tournament last');
      const croatiaMatches = descendants(japanTree).find((node) => hasClass(node, 'opponent-matches')
        && descendants(node).some((child) => child.getAttribute('href') === '#/m/M-2022-53'));
      deepEqual(croatiaMatches.childNodes.map((node) => Number(node.getAttribute('data-year'))), [2022, 2006, 1998],
        'Japan–Croatia matches descending');
      const playerRankingTree = rankingsView(rankings, teams, 'p', 'goals');
      equal(descendants(playerRankingTree).filter((node) => node.tagName === 'A' && /^#\/p\//.test(node.getAttribute('href') || '')).length,
        rankings.players.goals.length, 'ranking player links');

      const homeLinks = descendants(homeTree).filter((node) =>
        node.tagName === 'A' && /^#\/t\/\d{4}$/.test(node.getAttribute('href') || ''));
      equal(homeLinks.length, 23, 'home tournament links');
      equal(englishGroupLabels.length, 0, `English group headings or breadcrumbs: ${englishGroupLabels.slice(0, 3).join('; ')}`);

      const finalRound1950 = descendants(tournament1950Tree).find((node) => {
        if (!hasClass(node, 'stage-section')) return false;
        const heading = node.childNodes.find((child) => child instanceof FakeElement && child.tagName === 'H2');
        return heading?.textContent.startsWith('決勝');
      });
      equal(descendants(finalRound1950).filter((node) => hasClass(node, 'advanced-mark')).length, 0,
        '1950 final-round advance marks');
      equal(descendants(tournament1950Tree).filter((node) => hasClass(node, 'bracket')).length, 0, '1950 no chart');
      const hosts2002 = descendants(render('tournament 2002 host order', () =>
        tournamentView(details.find((detail) => detail.year === 2002), teams)))
        .find((node) => hasClass(node, 'team-list'));
      deepEqual(hosts2002.childNodes.map((node) => node.textContent), ['日本', '韓国'], '2002 host list Japan first');
      equal(descendants(tournament2022Tree).filter((node) => hasClass(node, 'bracket-box')).length, 15, '2022 chart boxes');
      const tournament1974Tree = render('tournament 1974 box count', () => tournamentView(details.find((detail) => detail.year === 1974), teams));
      equal(descendants(tournament1974Tree).filter((node) => hasClass(node, 'bracket-box')).length, 1, '1974 one chart box');
      const sections1974 = tournament1974Tree.childNodes.filter((node) => node instanceof FakeElement && hasClass(node, 'stage-section'));
      const chartIndex1974 = sections1974.findIndex((node) => descendants(node).some((descendant) => hasClass(descendant, 'bracket')));
      const thirdIndex1974 = sections1974.findIndex((node) => descendants(node).some((descendant) => hasClass(descendant, 'standalone-match')));
      equal(chartIndex1974 < thirdIndex1974, true, '1974 third-place card below chart');
      equal(replayTieVerified, true, 'replay tie render checked');
      equal(shootoutVerified, true, 'shootout result render checked');

      deepEqual(renderedAwardKeys(tournament2022Tree), [
        'golden-ball', 'silver-ball', 'bronze-ball', 'golden-boot',
        'silver-boot', 'bronze-boot', 'golden-glove', 'best-young-player',
      ], '2022 award order');
      deepEqual(renderedAwardKeys(tournament2026Tree), [
        'golden-ball', 'silver-ball', 'bronze-ball', 'golden-boot',
        'silver-boot', 'bronze-boot', 'golden-glove', 'best-young-player',
      ], '2026 award order');

      equal(/\.bracket-state-button\s*\{[^}]*min-height:\s*44px/s.test(readFileSync(join(ROOT, 'public/css/app.css'), 'utf8')), true,
        'bracket state button tap target');

      const firstCardCount = descendants(homeTree).find((node) => hasClass(node, 'card-count'));
      equal(firstCardCount.textContent.startsWith('出場国'), true, 'home first card count label first');

      const final2022 = descendants(tournament2022Tree).some((node) =>
        node.tagName === 'A' && node.getAttribute('href') === '#/m/M-2022-64');
      equal(final2022, true, '2022 final link');
      equal(canadaMoroccoTree.textContent.includes('オウンゴール'), true, 'Canada–Morocco own-goal label');
      const css = readFileSync(join(ROOT, 'public/css/app.css'), 'utf8');
      equal(/\.standings\s*\{[^}]*min-width\s*:\s*(?:[6-9]\d\d|\d{4,})px/s.test(css), false, 'standings has no wide min-width');
      equal(/\.standings\s*\{[^}]*font-size:\s*15px/s.test(css), true, 'standings number text is at least 15px');
      equal(/\.header-back\s*\{[^}]*min-height:\s*44px/s.test(css), true, 'header back tap height');
      equal(/\.country-link\s*\{[^}]*min-height:\s*44px/s.test(css), true, 'country link tap height');
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node;
      else globalThis.Node = previousNode;
    }
  });
}
