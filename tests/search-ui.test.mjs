import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import golden from './golden/lazykid.json' with { type: 'json' };
import { prepareIndex, search } from '../public/js/search.js?v=0.4.1';

const ROOT = resolve(import.meta.dirname, '..');
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, 'public/data', name), 'utf8'));

class FakeNode {}
class FakeText extends FakeNode {
  constructor(value) { super(); this.value = String(value); }
  get textContent() { return this.value; }
}
class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = new Map();
    this.value = '';
    this.classList = { toggle: () => {} };
  }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { for (const child of children) this.childNodes.push(child instanceof FakeNode ? child : new FakeText(child)); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  get textContent() { return this.childNodes.map((child) => child.textContent).join(''); }
}

function descendants(node) {
  if (!(node instanceof FakeElement)) return [];
  return [node, ...node.childNodes.flatMap(descendants)];
}
const hasClass = (node, name) => (node.getAttribute('class') || '').split(/\s+/).includes(name);
const settle = () => new Promise((resolvePromise) => setImmediate(resolvePromise));

export function register(test, equal) {
  test('search component is lazy on home and eager on search route', async () => {
    const previousDocument = globalThis.document;
    const previousNode = globalThis.Node;
    globalThis.Node = FakeNode;
    globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (value) => new FakeText(value) };
    try {
      const { homeView, searchView } = await import('../public/js/views.js?v=0.4.1');
      const tournaments = load('tournaments.json');
      const teams = load('teams.json');
      let loads = 0;
      const loadContext = async () => { loads += 1; return { index: [], players: {}, teams, tournaments }; };
      const options = { initialQuery: '', loadContext, updateUrl: () => {} };
      const home = homeView(tournaments, teams, options);
      equal(descendants(home).filter((node) => node.tagName === 'INPUT').length, 1, 'home input');
      equal(loads, 0, 'home before focus');
      const input = descendants(home).find((node) => node.tagName === 'INPUT');
      await input.listeners.get('focus')[0]();
      equal(loads, 1, 'home focus');
      searchView(options);
      await settle();
      equal(loads, 2, 'search route open');
    } finally {
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
    }
  });

  test('typing preserves the input node and replaces only search results', async () => {
    const previousDocument = globalThis.document;
    const previousNode = globalThis.Node;
    globalThis.Node = FakeNode;
    globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (value) => new FakeText(value) };
    try {
      const { searchComponent } = await import('../public/js/views.js?v=0.4.1');
      const entries = load('search.json');
      const context = {
        index: prepareIndex(entries), players: load('players.json'), teams: load('teams.json'), tournaments: load('tournaments.json'),
      };
      const urls = [];
      const tree = searchComponent({ initialQuery: '', loadContext: async () => context, updateUrl: (value) => urls.push(value) });
      const input = descendants(tree).find((node) => node.tagName === 'INPUT');
      const results = descendants(tree).find((node) => hasClass(node, 'search-results'));
      equal(input.getAttribute('type'), 'search');
      for (const [name, value] of [['enterkeyhint', 'search'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false']]) {
        equal(input.getAttribute(name), value, name);
      }
      await input.listeners.get('focus')[0]();
      input.value = 'め';
      input.listeners.get('input')[0]();
      const firstResults = results.childNodes[0];
      input.value = 'めっし';
      input.listeners.get('input')[0]();
      equal(descendants(tree).find((node) => node.tagName === 'INPUT'), input, 'same input instance');
      equal(results.childNodes[0] === firstResults, false, 'results subtree replaced');
      equal(descendants(results).some((node) => node.getAttribute('href') === '#/p/P-14758'), true, 'Messi result link');
      equal(descendants(results).filter((node) => hasClass(node, 'search-result')).every((node) => node.tagName === 'A'), true, 'one link per row');
      equal(urls.at(-1), 'めっし', 'URL callback query');
    } finally {
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
    }
  });

  test('search render sweep covers every lazy query and expected target view', async () => {
    const previousDocument = globalThis.document;
    const previousNode = globalThis.Node;
    globalThis.Node = FakeNode;
    globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (value) => new FakeText(value) };
    try {
      const { countryView, playerView, searchView, tournamentView } = await import('../public/js/views.js?v=0.4.1');
      const entries = load('search.json');
      const players = load('players.json');
      const teams = load('teams.json');
      const tournaments = load('tournaments.json');
      const details = new Map(tournaments.map(({ year }) => [year, load(`t/${year}.json`)]));
      const context = { index: prepareIndex(entries), players, teams, tournaments };
      let searchRenders = 0;
      for (const item of golden.cases) {
        const tree = searchView({ initialQuery: item.q, loadContext: async () => context, updateUrl: () => {} });
        await settle();
        equal(descendants(tree).find((node) => node.tagName === 'INPUT').value, item.q, item.q);
        searchRenders += 1;
      }
      const targets = new Map();
      for (const item of golden.cases) for (const target of [item.first, ...(item.top3 || [])].filter(Boolean)) targets.set(`${target.type}:${target.id}`, target);
      for (const target of targets.values()) {
        let tree;
        if (target.type === 'team') tree = countryView(target.id, teams);
        else if (target.type === 'tournament') tree = tournamentView(details.get(Number(target.id)), teams);
        else {
          const player = players[target.id];
          tree = playerView(target.id, player, player.years.map((year) => details.get(year)), teams);
        }
        equal(Boolean(tree), true, `${target.type}:${target.id}`);
      }
      equal(searchRenders, golden.cases.length);
      console.log(`search render counts: queries=${searchRenders} targets=${targets.size}`);
    } finally {
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
      if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
    }
  });
}
