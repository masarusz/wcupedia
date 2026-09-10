#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import { register as textTests } from './text.test.mjs';
import { register as dataTests } from './data.test.mjs';
import { register as csvTests } from './csv.test.mjs';
import { register as standings2026Tests } from './standings-2026.test.mjs';
import { register as uiTests } from './ui.test.mjs';
import { register as viewsRenderTests } from './views-render.test.mjs';

const checks = [];
const test = (name, run) => checks.push({ name, run });
const describe = (value) => typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
const equal = (actual, expected, context = '') => {
  if (!Object.is(actual, expected)) throw new Error(`${context ? `${context}: ` : ''}expected ${describe(expected)}, got ${describe(actual)}`);
};
const deepEqual = (actual, expected, context = '') => {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${context ? `${context}: ` : ''}expected ${describe(expected)}, got ${describe(actual)}`);
};

textTests(test, equal, deepEqual);
csvTests(test, equal, deepEqual);
standings2026Tests(test, equal, deepEqual);
dataTests(test, equal, deepEqual);
uiTests(test, equal, deepEqual);
viewsRenderTests(test, equal, deepEqual);

let passed = 0;
let failed = 0;
for (const check of checks) {
  try {
    await check.run();
    console.log(`ok - ${check.name}`);
    passed += 1;
  } catch (error) {
    console.log(`not ok - ${check.name} - ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
