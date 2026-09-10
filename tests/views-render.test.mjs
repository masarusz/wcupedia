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

export function register(test, equal) {
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
      let tournament2022Tree;
      let canadaMoroccoTree;
      for (const detail of details) {
        const tree = render(`tournament ${detail.year}`, () => tournamentView(detail, teams));
        if (tree) tournamentRenders += 1;
        if (detail.year === 2022) tournament2022Tree = tree;

        for (const match of detail.matches) {
          const matchTree = render(`match ${match.id}`, () => matchView(detail, match, teams));
          if (matchTree) matchRenders += 1;
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
