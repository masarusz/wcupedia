import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isAllowedPhotoLicence, validatePhotoManifest, validatePhotoOriginals } from '../tools/lib/photos.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'curated/photos.json'), 'utf8'));
const entries = validatePhotoManifest(manifest);

function webpInfo(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error(`${path}: invalid RIFF/WEBP header`);
  }
  const chunks = [];
  let width = null;
  let height = null;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    chunks.push(type);
    if (type === 'VP8 ') {
      width = buffer.readUInt16LE(data + 6) & 0x3fff;
      height = buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (type === 'VP8L') {
      width = 1 + buffer[data + 1] + ((buffer[data + 2] & 0x3f) << 8);
      height = 1 + (buffer[data + 2] >> 6) + (buffer[data + 3] << 2) + ((buffer[data + 4] & 0x0f) << 10);
    } else if (type === 'VP8X') {
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    }
    offset = data + size + (size % 2);
  }
  return { buffer, chunks, width, height };
}

class FakeNode {}
class FakeText extends FakeNode {
  constructor(value) { super(); this.value = String(value); }
  get textContent() { return this.value; }
}
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.childNodes = []; this.attributes = new Map(); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...children) { this.childNodes.push(...children.map((child) => child instanceof FakeNode ? child : new FakeText(child))); }
}

export function register(test, equal, deepEqual) {
  test('photo licence, credit, face-box, and original validation is strict', async () => {
    for (const value of ['CC0', 'Public domain', 'CC BY 4.0', 'CC BY-SA 3.0 nl', 'Attribution']) {
      equal(isAllowedPhotoLicence(value), true, value);
    }
    for (const value of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'GFDL']) equal(isAllowedPhotoLicence(value), false, value);
    const base = { file: 'x.jpg', licence: 'CC BY 4.0', licenceUrl: '', artist: 'A', source: 'S', size: [10, 10], face: [0.1, 0.1, 0.2, 0.2] };
    for (const [label, change] of [
      ['artist', { artist: '' }], ['source', { source: '' }], ['face coordinate', { face: [0.9, 0.1, 0.2, 0.2] }],
    ]) {
      let failed = false;
      try { validatePhotoManifest({ 'P-00001': { ...base, ...change } }); } catch { failed = true; }
      equal(failed, true, label);
    }
    let missingFailed = false;
    const empty = mkdtempSync(join(tmpdir(), 'wcupedia-missing-photo-'));
    try { await validatePhotoOriginals([['P-00001', base]], empty); } catch { missingFailed = true; }
    finally { rmSync(empty, { recursive: true, force: true }); }
    equal(missingFailed, true, 'missing original');
  });

  test('committed player WebPs are complete, bounded, clean, and deterministic', () => {
    const output = join(ROOT, 'public/assets/players');
    const ids = entries.map(([id]) => id);
    const webps = readdirSync(output).filter((name) => name.endsWith('.webp')).map((name) => name.slice(0, -5)).sort();
    deepEqual(webps, ids, 'manifest/WebP bijection');
    for (const id of ids) {
      const info = webpInfo(join(output, `${id}.webp`));
      deepEqual([info.width, info.height], [240, 320], id);
      equal(info.buffer.length <= 40 * 1024, true, `${id} ${info.buffer.length} bytes`);
      equal(info.chunks.some((chunk) => ['EXIF', 'XMP ', 'ICCP'].includes(chunk)), false, `${id}: ${info.chunks.join(',')}`);
    }
    // Rebuild the complete small fixture.  Once the orchestrator installs the
    // full manifest, use a stable spread so this regression stays under the
    // suite's one-minute budget while the cheap structural checks above still
    // cover every committed portrait.
    const rebuildEntries = entries.length <= 64
      ? entries
      : Array.from({ length: 24 }, (_unused, index) => entries[Math.floor(index * (entries.length - 1) / 23)]);
    const fresh = mkdtempSync(join(tmpdir(), 'wcupedia-photos-'));
    const freshOutput = join(fresh, 'out');
    const freshManifest = join(fresh, 'photos.json');
    try {
      writeFileSync(freshManifest, `${JSON.stringify(Object.fromEntries(rebuildEntries), null, 2)}\n`);
      execFileSync('python3', [join(ROOT, 'scripts/build_photos.py'), '--manifest', freshManifest, '--out', freshOutput], { cwd: ROOT });
      for (const [id] of rebuildEntries) {
        deepEqual(readFileSync(join(freshOutput, `${id}.webp`)), readFileSync(join(output, `${id}.webp`)), id);
      }
      writeFileSync(join(freshOutput, 'stale.webp'), 'stale');
      execFileSync('python3', [join(ROOT, 'scripts/build_photos.py'), '--manifest', freshManifest, '--out', freshOutput], { cwd: ROOT });
      equal(existsSync(join(freshOutput, 'stale.webp')), false, 'stale WebP removed');
      console.log(`photo rebuild comparison: selected=${rebuildEntries.length} total=${entries.length}`);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test('six-thousand-photo validation and credits render stay within 1.5 seconds', async () => {
    const synthetic = {};
    const credits = {};
    for (let index = 1; index <= 6000; index += 1) {
      const id = `P-${String(index).padStart(5, '0')}`;
      synthetic[id] = { licence: 'CC BY-SA 3.0 nl', licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0/nl/', artist: `Artist ${index}`, source: 'https://commons.wikimedia.org/', size: [500, 750], face: [0.2, 0.5, 0.2, 0.2] };
      credits[id] = { ...synthetic[id], name: `Player ${index}`, ja: null, team: 'JPN' };
    }
    const started = performance.now();
    equal(validatePhotoManifest(synthetic).length, 6000);
    const previousNode = globalThis.Node;
    const previousDocument = globalThis.document;
    globalThis.Node = FakeNode;
    globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (value) => new FakeText(value) };
    try {
      const { photoCreditsView } = await import('../public/js/views.js?v=0.5.3');
      const tree = photoCreditsView(credits);
      const list = tree.childNodes.find((node) => node.tagName === 'UL');
      equal(list.childNodes.length, 6000, 'credit rows');
      equal(list.childNodes.some((row) => row.childNodes.some((node) => node.tagName === 'IMG')), false, 'credits render no images');
    } finally {
      if (previousNode === undefined) delete globalThis.Node; else globalThis.Node = previousNode;
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    }
    const elapsed = performance.now() - started;
    console.log(`photo scale: entries=6000 budget=1500ms elapsed=${elapsed.toFixed(1)}ms`);
    equal(elapsed < 1500, true, `${elapsed.toFixed(1)}ms`);
  });
}
