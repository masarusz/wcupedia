import { conductScore, rankGroup2026 } from '../tools/lib/standings-2026.mjs';

const match = (home, away, homeScore, awayScore, homeBookings = [], awayBookings = []) => ({
  home, away, score: { home: homeScore, away: awayScore }, bookings: { home: homeBookings, away: awayBookings },
});
const order = (teams, matches) => rankGroup2026(teams, matches, { groupName: 'unit test' }).map((row) => row.team);

export function register(test, equal, deepEqual) {
  test('2026 tiebreak applies head-to-head before overall figures', () => {
    const matches = [
      match('A', 'B', 2, 0), match('B', 'C', 3, 0), match('C', 'A', 1, 0),
      match('A', 'D', 4, 2), match('B', 'D', 3, 1), match('C', 'D', 5, 0),
    ];
    deepEqual(order(['A', 'B', 'C', 'D'], matches), ['B', 'A', 'C', 'D']);
  });

  test('2026 head-to-head result outranks a better overall goal difference', () => {
    const matches = [
      match('A', 'B', 0, 1), match('A', 'C', 5, 0), match('A', 'D', 5, 0),
      match('B', 'C', 1, 0), match('B', 'D', 0, 5), match('C', 'D', 0, 0),
    ];
    deepEqual(order(['A', 'B', 'C', 'D'], matches), ['B', 'A', 'D', 'C']);
  });

  test('2026 tiebreak reapplies head-to-head to the still-tied subset', () => {
    const matches = [
      match('A', 'B', 0, 0), match('A', 'C', 0, 1), match('A', 'D', 1, 0),
      match('B', 'C', 1, 0), match('B', 'D', 0, 2), match('C', 'D', 0, 0),
    ];
    // All four have four points. A and C are level in the first mini-table;
    // reapplying their mutual match puts C ahead of A.
    deepEqual(order(['A', 'B', 'C', 'D'], matches), ['D', 'C', 'A', 'B']);
  });

  test('2026 tiebreak uses one conduct deduction per player per match', () => {
    const yellow = { type: 'Y', name: 'Alice' };
    const secondYellow = { type: 'Y/R', name: 'Bob' };
    equal(conductScore([{ type: 'Y', name: 'Bob' }, secondYellow]), -3);
    deepEqual(order(['A', 'B'], [match('A', 'B', 0, 0, [yellow], [{ type: 'Y', name: 'Bob' }, secondYellow])]), ['A', 'B']);
  });

  test('2026 conduct rejects unknown booking types', () => {
    let message = null;
    try { conductScore([{ type: 'blue', name: 'Alice' }]); } catch (error) { message = error.message; }
    equal(typeof message, 'string');
    equal(message.includes('unknown 2026 booking type'), true);
  });
}
