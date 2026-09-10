#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rawUrl, SOURCES } from './lib/sources.mjs';

const args = process.argv.slice(2);
let out = '.cache/sources';
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--out' && args[index + 1]) out = args[++index];
  else throw new Error(`usage: node tools/fetch-sources.mjs [--out DIR]`);
}
out = resolve(out);
const temporary = await mkdtemp(join(tmpdir(), 'wcupedia-sources-'));
const manifest = {};
try {
  for (const [sourceName, source] of Object.entries(SOURCES)) {
    manifest[sourceName] = { sha: source.sha, repo: source.repo, files: {} };
    for (const { localFile } of source.files) {
      const url = rawUrl(sourceName, localFile);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const target = join(temporary, sourceName, localFile);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      manifest[sourceName].files[localFile] = createHash('sha256').update(bytes).digest('hex');
    }
  }
  await writeFile(join(temporary, 'SOURCES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(dirname(out), { recursive: true });
  const backup = `${out}.previous-${process.pid}`;
  let hadExisting = false;
  try {
    await rename(out, backup);
    hadExisting = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(temporary, out);
    if (hadExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadExisting) await rename(backup, out);
    throw error;
  }
  console.log(`Fetched ${Object.values(SOURCES).reduce((sum, source) => sum + source.files.length, 0)} files into ${out}`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
