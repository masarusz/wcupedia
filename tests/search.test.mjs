import { prepareIndex, search } from '../public/js/search.js?v=0.4.1';

const entry = (type, id, label, keys) => ({ type, id, label, keys });

export function register(test, equal, deepEqual) {
  test('search strict exact word prefix and substring tiers', () => {
    const index = prepareIndex([
      entry('team', 'exact', 'Exact', ['alpha beta']),
      entry('team', 'word', 'Word', ['red blue']),
      entry('team', 'prefix', 'Prefix', ['green field']),
      entry('team', 'substring', 'Substring', ['violet']),
    ]);
    equal(search(index, 'alphabeta')[0].tier, 0, 'compact exact');
    equal(search(index, 'blue')[0].tier, 1, 'whole word');
    equal(search(index, 'gre')[0].tier, 2, 'prefix');
    equal(search(index, 'ole')[0].tier, 3, 'substring');
    deepEqual(search(index, ''), [], 'empty query');
  });

  test('search loose tiers follow all strict matches', () => {
    const index = prepareIndex([
      entry('player', 'strict', 'Strict', ['めし']),
      entry('player', 'loose', 'Loose', ['めっし']),
      entry('player', 'long', 'Long', ['めっしゅ']),
    ]);
    deepEqual(search(index, 'めし').map((result) => [result.id, result.tier]), [
      ['strict', 0], ['loose', 10], ['long', 12],
    ]);
    equal(search(prepareIndex([entry('team', 'v', 'V', ['ゔぃせる'])]), 'ぶい')[0].tier, 12, 'vu becomes bu');
  });

  test('search never uses one-character substring matching', () => {
    const index = prepareIndex([entry('team', 'inside', 'Inside', ['あいう']), entry('team', 'prefix', 'Prefix', ['うえ'])]);
    deepEqual(search(index, 'い'), []);
    deepEqual(search(index, 'う').map((result) => [result.id, result.tier]), [['prefix', 2]]);
  });

  test('search orders types team tournament player within a tier', () => {
    const index = prepareIndex([
      entry('player', 'p', 'P', ['same']), entry('tournament', 't', 'T', ['same']), entry('team', 'c', 'C', ['same']),
    ]);
    deepEqual(search(index, 'same').map((result) => result.type), ['team', 'tournament', 'player']);
  });

  test('search player fame uses goals appearances and squads in order', () => {
    const index = prepareIndex([
      entry('player', 'squads', 'Same', ['star']), entry('player', 'apps', 'Same', ['star']),
      entry('player', 'goals', 'Same', ['star']), entry('player', 'plain', 'Same', ['star']),
    ]);
    const players = {
      goals: { goals: 2, apps: 0, years: [] }, apps: { goals: 1, apps: 7, years: [2000] },
      squads: { goals: 1, apps: 6, years: [2000, 2004] }, plain: { goals: 1, years: [2000] },
    };
    deepEqual(search(index, 'star', { players }).map((result) => result.id), ['goals', 'apps', 'squads', 'plain']);
  });

  test('search ordering is deterministic with label then id fallbacks', () => {
    const entries = [
      entry('team', 'z', 'Bravo', ['x']), entry('team', 'b', 'Alpha', ['x']), entry('team', 'a', 'Alpha', ['x']),
    ];
    const forward = search(prepareIndex(entries), 'x').map((result) => result.id);
    const reverse = search(prepareIndex(entries.toReversed()), 'x').map((result) => result.id);
    deepEqual(forward, ['a', 'b', 'z']);
    deepEqual(reverse, forward);
  });

  test('search limit is applied after ranking', () => {
    const index = prepareIndex(Array.from({ length: 35 }, (_, number) => entry('team', String(number), String(number), ['common'])));
    equal(search(index, 'common').length, 30);
    equal(search(index, 'common', { limit: 2 }).length, 2);
  });
}
