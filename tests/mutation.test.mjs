import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export function register(test, equal) {
  test('required search and Phase 4c mutations are killed', () => {
    const output = execFileSync(process.execPath, [resolve(ROOT, 'tests/mutate.mjs')], { cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(output);
    equal(output.includes('mutations: 20/20 killed'), true);
  });
}
