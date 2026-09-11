#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import { register as textTests } from './text.test.mjs';
import { register as dataTests } from './data.test.mjs';
import { register as csvTests } from './csv.test.mjs';
import { register as standings2026Tests } from './standings-2026.test.mjs';
import { register as uiTests } from './ui.test.mjs';
import { register as viewsRenderTests } from './views-render.test.mjs';
import { register as bracketLayoutTests } from './bracket-layout.test.mjs';
import { register as playersJaTests } from './players-ja.test.mjs';
import { register as phase4Tests } from './phase4.test.mjs';
import { register as searchTests } from './search.test.mjs';
import { register as lazyKidTests } from './lazy-kid.test.mjs';
import { register as searchBuildTests } from './search-build.test.mjs';
import { register as searchUiTests } from './search-ui.test.mjs';
import { register as mutationTests } from './mutation.test.mjs';
import { register as agesTests } from './ages.test.mjs';
import { register as navigationTests } from './navigation.test.mjs';
import { register as meikanTests } from './meikan.test.mjs';
import { register as photoTests } from './photos.test.mjs';

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
bracketLayoutTests(test, equal, deepEqual);
playersJaTests(test, equal, deepEqual);
phase4Tests(test, equal, deepEqual);
searchTests(test, equal, deepEqual);
searchBuildTests(test, equal, deepEqual);
lazyKidTests(test, equal, deepEqual);
searchUiTests(test, equal, deepEqual);
mutationTests(test, equal, deepEqual);
agesTests(test, equal, deepEqual);
navigationTests(test, equal, deepEqual);
meikanTests(test, equal, deepEqual);
photoTests(test, equal, deepEqual);
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
