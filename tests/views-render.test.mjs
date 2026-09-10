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

function topLevelRules(css) {
  const rules = [];
  let cursor = 0;
  let depth = 0;
  let header = '';
  let bodyStart = 0;
  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === '{') {
      if (depth === 0) {
        header = css.slice(cursor, index).trim();
        bodyStart = index + 1;
      }
      depth += 1;
    } else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push({ header, body: css.slice(bodyStart, index) });
        cursor = index + 1;
      }
    }
  }
  return rules;
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
        await import('../public/js/views.js?v=0.1.0');
      const tournaments = load('tournaments.json');
      const teams = load('teams.json');
      const meta = load('meta.json');
      const details = tournaments.map(({ year }) => load(`t/${year}.json`));
      const errors = [];
      const englishGroupLabels = [];
      let tournamentRenders = 0;
      let matchRenders = 0;
      let missingAlt = 0;

      const render = (label, view) => {
        try {
          const tree = view();
          missingAlt += descendants(tree).filter((node) => node.tagName === 'IMG' && !node.hasAttribute('alt')).length;
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
      for (const detail of details) {
        const tree = render(`tournament ${detail.year}`, () => tournamentView(detail, teams));
        if (tree) tournamentRenders += 1;
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

      console.log(`views render counts: tournaments=${tournamentRenders} matches=${matchRenders} exceptions=${errors.length}`);
      if (errors.length) throw new Error(`render exceptions: ${errors.slice(0, 3).join('; ')}`);
      equal(tournamentRenders, 23, 'tournament render count');
      equal(matchRenders, 1068, 'match render count');
      equal(missingAlt, 0, 'images missing alt');

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

      deepEqual(renderedAwardKeys(tournament2022Tree), [
        'golden-ball', 'silver-ball', 'bronze-ball', 'golden-boot',
        'silver-boot', 'bronze-boot', 'golden-glove', 'best-young-player',
      ], '2022 award order');
      deepEqual(renderedAwardKeys(tournament2026Tree), [
        'golden-ball', 'golden-boot', 'golden-glove', 'best-young-player',
      ], '2026 award order');

      const rubyRule = topLevelRules(readFileSync(join(ROOT, 'public/css/app.css'), 'utf8')).find(({ header }) =>
        header.split(',').map((selector) => selector.trim()).includes('ruby'));
      equal(Boolean(rubyRule && /(?:^|;)\s*ruby-align\s*:\s*center\s*(?:;|$)/.test(rubyRule.body)), true,
        'top-level ruby alignment');

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
