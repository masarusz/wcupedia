import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { backDecision } from '../public/js/navigation.js?v=0.5.3';

const ROOT = resolve(import.meta.dirname, '..');

export function register(test, equal, deepEqual) {
  test('もどる chooses visit history or the natural parent route', () => {
    deepEqual(backDecision('/p/P-14758', true), { action: 'back' }, 'earlier player page');
    deepEqual(backDecision('/m/M-2022-64', false), { action: 'hash', hash: '#/t/2022' }, 'direct match');
    deepEqual(backDecision('/c/JPN', false), { action: 'hash', hash: '#/c' }, 'direct country');
    for (const route of ['/t/2022', '/p/P-14758', '/r/p/youngest', '/s', '/credits', '/missing']) {
      deepEqual(backDecision(route, false), { action: 'hash', hash: '#/' }, route);
    }
  });

  test('search URL replacement preserves visit state for もどる', () => {
    const state = { wcupediaVisit: 'visit', wcupediaVisitIndex: 2, unrelated: true };
    let replacedState = null;
    const history = { state, replaceState: (next) => { replacedState = next; } };
    history.replaceState(history.state, '', '#/s?q=%E3%82%81%E3%81%A3%E3%81%97');
    equal(replacedState, state, 'same state object retained');
    deepEqual(backDecision('/s', replacedState.wcupediaVisitIndex > 0), { action: 'back' });
    const appSource = readFileSync(resolve(ROOT, 'public/js/app.js'), 'utf8');
    equal(appSource.includes("history.replaceState(history.state, '', `#${path}${suffix}`)"), true, 'real search update preserves state');
    equal(appSource.includes('history.replaceState(null'), false, 'no null replacement state');
  });
}
