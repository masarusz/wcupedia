import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareIndex, search } from '../public/js/search.js?v=0.5.4';
import golden from './golden/lazykid.json' with { type: 'json' };

const ROOT = resolve(import.meta.dirname, '..');
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, 'public/data', name), 'utf8'));
const sameTarget = (actual, expected) => actual?.type === expected.type && actual?.id === expected.id;

export function register(test, equal) {
  test('lazy-kid golden search cases', () => {
    const index = prepareIndex(load('search.json'));
    const players = load('players.json');
    const failures = [];
    let passed = 0;
    for (const item of golden.cases) {
      const results = search(index, item.q, { players });
      let ok = !item.first || sameTarget(results[0], item.first);
      ok &&= (item.top3 || []).every((expected) => results.slice(0, 3).some((result) => sameTarget(result, expected)));
      ok &&= (item.mustNotInclude || []).every((expected) => !results.some((result) => sameTarget(result, expected)));
      if (item.noResults) ok &&= results.length === 0;
      if (ok) passed += 1;
      else failures.push(`${JSON.stringify(item.q)}: ${results.slice(0, 3).map((result) => `${result.type}:${result.id}@${result.tier}`).join(', ') || '(none)'}`);
    }
    for (const failure of failures) console.log(`lazy-kid failure - ${failure}`);
    console.log(`lazy-kid: ${passed}/${golden.cases.length}`);
    equal(passed, golden.cases.length, failures.join('; '));
  });
}
