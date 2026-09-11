import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const PHOTO_ID = /^(?:P-\d+|P26-[a-f0-9]{10})$/;
const CC_LICENCE = /^CC BY(?:-SA)? \d+(?:\.\d+)*(?: [a-z]{2,3})?$/i;

export function isAllowedPhotoLicence(value) {
  return value === 'CC0' || value === 'Public domain' || value === 'Attribution'
    || (typeof value === 'string' && CC_LICENCE.test(value));
}

export function validatePhotoManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('photo manifest must be an object');
  }
  const entries = [];
  for (const [id, photo] of Object.entries(manifest)) {
    if (id === '_about') continue;
    if (!PHOTO_ID.test(id)) throw new Error(`invalid photo player id ${id}`);
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) throw new Error(`invalid photo entry ${id}`);
    if (!isAllowedPhotoLicence(photo.licence)) throw new Error(`disallowed photo licence ${id}: ${photo.licence}`);
    if (typeof photo.artist !== 'string' || !photo.artist.trim()) throw new Error(`empty photo artist ${id}`);
    if (typeof photo.source !== 'string' || !photo.source.trim()) throw new Error(`empty photo source ${id}`);
    if (typeof photo.licenceUrl !== 'string') throw new Error(`invalid photo licence URL ${id}`);
    if (!Array.isArray(photo.size) || photo.size.length !== 2
      || !photo.size.every((value) => Number.isInteger(value) && value > 0)) {
      throw new Error(`invalid photo size ${id}`);
    }
    if (!Array.isArray(photo.face) || photo.face.length !== 4
      || !photo.face.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error(`invalid photo face box ${id}`);
    }
    const [x, y, width, height] = photo.face;
    if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      throw new Error(`photo face box outside image ${id}`);
    }
    entries.push([id, photo]);
  }
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return entries;
}

export async function validatePhotoOriginals(entries, originalRoot) {
  for (const [id] of entries) {
    const path = join(originalRoot, `${id}.jpg`);
    try {
      await access(path, constants.R_OK);
    } catch {
      throw new Error(`missing photo original ${id}: ${path}`);
    }
  }
}
