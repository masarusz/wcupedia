import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
    const previousFetch = globalThis.fetch;
    const appRoot = new FakeElement('div');
    globalThis.Node = FakeNode;
    globalThis.document = {
      createElement: (tagName) => new FakeElement(tagName),
      createTextNode: (value) => new FakeText(value),
      querySelector: (selector) => selector === '#app' ? appRoot : null,
    };
    globalThis.window = { addEventListener: () => {}, scrollTo: () => {} };
    globalThis.location = { hash: '' };
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => load(String(url).split('?')[0].replace(/^data\//, '')),
    });

    try {
      await import(`../public/js/app.js?shell-test=${Date.now()}`);
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      equal(descendants(appRoot).some((node) => node.tagName === 'BUTTON'), false, 'shell buttons');
      equal(descendants(appRoot).some((node) => node.tagName === 'RUBY' || node.tagName === 'RT'), false,
        'shell ruby or rt elements');
      equal(descendants(appRoot).find((node) => hasClass(node, 'subtitle')).textContent, 'Wカップ大図鑑',
        'home title without reading');
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node;
      else globalThis.Node = previousNode;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousLocation === undefined) delete globalThis.location;
      else globalThis.location = previousLocation;
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
      const { creditsView, errorView, homeView, matchView, notFoundView, tournamentView } =
        await import('../public/js/views.js?v=0.2.2');
      const tournaments = load('tournaments.json');
      const teams = load('teams.json');
      const meta = load('meta.json');
      const details = tournaments.map(({ year }) => load(`t/${year}.json`));
      const errors = [];
      const englishGroupLabels = [];
      let tournamentRenders = 0;
      let matchRenders = 0;
      let bracketStateRenders = 0;
      let missingAlt = 0;
      let readingElementCount = 0;
      const readingElementSamples = [];

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
          return tree;
        } catch (error) {
          errors.push(`${label}: ${error.message}`);
          return null;
        }
      };

      const homeTree = render('home', () => homeView(tournaments, teams));
      let tournament1950Tree;
      let tournament2022Tree;
      let tournament2026Tree;
      let canadaMoroccoTree;
      let replayTieVerified = false;
      let shootoutVerified = false;
      for (const detail of details) {
        const tree = render(`tournament ${detail.year}`, () => tournamentView(detail, teams));
        if (tree) tournamentRenders += 1;
        const knockoutRounds = detail.stages.filter((stage) => ['r32', 'r16', 'qf', 'sf', 'final'].includes(stage));
        const chart = descendants(tree).find((node) => hasClass(node, 'bracket'));
        equal(Boolean(chart), knockoutRounds.length > 0, `${detail.year} chart presence`);
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
        }
        if (detail.year === 1950) tournament1950Tree = tree;
        if (detail.year === 2022) tournament2022Tree = tree;
        if (detail.year === 2026) tournament2026Tree = tree;

        for (const match of detail.matches) {
          const matchTree = render(`match ${match.id}`, () => matchView(detail, match, teams));
          if (matchTree) matchRenders += 1;
          const breadcrumb = descendants(matchTree).find((node) => hasClass(node, 'breadcrumb'));
          if (breadcrumb.textContent.includes('Group ')) englishGroupLabels.push(`match ${match.id}: ${breadcrumb.textContent}`);
          if (detail.year === 2022 && match.home === 'CAN' && match.away === 'MAR') canadaMoroccoTree = matchTree;
        }
      }
      render('credits', () => creditsView(meta));
      render('not found', () => notFoundView());
      render('error', () => errorView(() => {}));

      console.log(`views render counts: tournaments=${tournamentRenders} matches=${matchRenders} bracket-states=${bracketStateRenders} exceptions=${errors.length}`);
      if (errors.length) throw new Error(`render exceptions: ${errors.slice(0, 3).join('; ')}`);
      equal(tournamentRenders, 23, 'tournament render count');
      equal(matchRenders, 1068, 'match render count');
      equal(bracketStateRenders > 0, true, 'all available bracket states rendered');
      equal(missingAlt, 0, 'images missing alt');
      equal(readingElementCount, 0, `ruby or rt elements rendered: ${readingElementSamples.join(', ')}`);

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
        'golden-ball', 'golden-boot', 'golden-glove', 'best-young-player',
      ], '2026 award order');

      equal(/\.bracket-state-button\s*\{[^}]*min-height:\s*44px/s.test(readFileSync(join(ROOT, 'public/css/app.css'), 'utf8')), true,
        'bracket state button tap target');

      const firstCardCount = descendants(homeTree).find((node) => hasClass(node, 'card-count'));
      equal(firstCardCount.textContent.startsWith('出場国'), true, 'home first card count label first');

      const final2022 = descendants(tournament2022Tree).some((node) =>
        node.tagName === 'A' && node.getAttribute('href') === '#/m/M-2022-64');
      equal(final2022, true, '2022 final link');
      equal(canadaMoroccoTree.textContent.includes('オウンゴール'), true, 'Canada–Morocco own-goal label');
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node;
      else globalThis.Node = previousNode;
    }
  });
}
