import golden from './golden/text.json' with { type: 'json' };
import { fold, foldCompact } from '../public/js/fold.js';
import { parseRuby, rubyPlain, rubyReading } from '../public/js/ruby.js';

export function register(test, equal, deepEqual) {
  test('golden fold cases', () => {
    equal(golden.fold.length > 0, true);
    for (const [input, expected] of golden.fold) equal(fold(input), expected, input);
  });
  test('golden foldCompact cases', () => {
    equal(golden.foldCompact.length > 0, true);
    for (const [input, expected] of golden.foldCompact) equal(foldCompact(input), expected, input);
  });
  test('golden fold exclusions', () => {
    equal(golden.mustNotContain.length > 0, true);
    for (const item of golden.mustNotContain) equal(fold(item.haystack).includes(fold(item.needle)), false, item.why);
  });
  test('golden ruby valid cases', () => {
    equal(golden.ruby.valid.length > 0, true);
    for (const item of golden.ruby.valid) {
      deepEqual(parseRuby(item.input), item.parts, `${item.input} parts`);
      equal(rubyPlain(item.input), item.plain, `${item.input} plain`);
      equal(rubyReading(item.input), item.reading, `${item.input} reading`);
    }
  });
  test('golden ruby invalid cases', () => {
    equal(golden.ruby.invalid.length > 0, true);
    for (const input of golden.ruby.invalid) {
      let threw = false;
      try { parseRuby(input); } catch { threw = true; }
      equal(threw, true, `${input} must throw`);
    }
  });
}
