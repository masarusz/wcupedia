import { parseCsv } from '../tools/lib/csv.mjs';

function thrownMessage(run) {
  try {
    run();
    return null;
  } catch (error) {
    return error.message;
  }
}

export function register(test, equal, deepEqual) {
  test('CSV quoted fields, newlines, CRLF, and BOM', () => {
    deepEqual(parseCsv('name,note\nAlice,"said ""hello"""\n'), [{ name: 'Alice', note: 'said "hello"' }]);
    deepEqual(parseCsv('name,note\nAlice,"first\nsecond"\n'), [{ name: 'Alice', note: 'first\nsecond' }]);
    deepEqual(parseCsv('name,note\r\nAlice,ok\r\n'), [{ name: 'Alice', note: 'ok' }]);
    deepEqual(parseCsv('\uFEFFname,note\nAlice,ok\n'), [{ name: 'Alice', note: 'ok' }]);
  });

  test('CSV rejects junk after a closing quote', () => {
    const message = thrownMessage(() => parseCsv('a,b\n"x"junk,y\n'));
    equal(typeof message, 'string');
    equal(message.includes('line 2'), true, message);
  });

  test('CSV rejects unterminated quoted fields', () => {
    const message = thrownMessage(() => parseCsv('a,b\n"x\ny'));
    equal(typeof message, 'string');
    equal(message.includes('line 3'), true, message);
  });
}
