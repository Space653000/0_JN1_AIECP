'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { redactSensitive, redactText } = require('./redaction.cjs');

const sha256Buffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
async function sha256(file) { return sha256Buffer(await fs.readFile(file)); }

// Task ids come from a model-produced plan, so a file name is never used as given.
const safeSegment = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 180) || '_';

function versionedName(name, version) {
  if (version <= 1) return name;
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)}.v${version}${ext}`;
}

// Evidence is write-once. Identical content is idempotent; different content never replaces an existing
// file, it is stored as the next version (name.v2.ext, name.v3.ext ...) and the returned reference points to it.
async function writeImmutable(dir, name, data) {
  const target = path.resolve(dir);
  await fs.mkdir(target, { recursive: true });
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const digest = sha256Buffer(buffer);
  const base = safeSegment(name);
  for (let version = 1; version <= 1000; version++) {
    const file = path.join(target, versionedName(base, version));
    if (path.dirname(file) !== target) throw new Error('Evidence path escaped its directory.');
    try {
      await fs.writeFile(file, buffer, { flag: 'wx' });
      return { file, sha256: digest, bytes: buffer.length, version };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(file).catch(() => null);
      if (existing && sha256Buffer(existing) === digest) return { file, sha256: digest, bytes: buffer.length, version };
    }
  }
  throw new Error('Too many evidence versions.');
}

// Re-hash the referenced file. A missing file, a path outside the allowed root or a different hash is reported.
async function verifyEvidenceRef(ref, root = null) {
  if (!ref || typeof ref.file !== 'string' || !/^[0-9a-f]{64}$/i.test(ref.sha256 || '')) return { ok: false, reason: 'BAD_REFERENCE' };
  const file = path.resolve(ref.file);
  if (root) {
    const base = path.resolve(root);
    if (file !== base && !file.startsWith(base + path.sep)) return { ok: false, reason: 'OUTSIDE_ROOT' };
  }
  let actual;
  try { actual = await sha256(file); } catch { return { ok: false, reason: 'MISSING' }; }
  return actual.toLowerCase() === ref.sha256.toLowerCase() ? { ok: true, reason: 'OK', actual } : { ok: false, reason: 'HASH_MISMATCH', actual };
}

class EvidenceManager {
  constructor(root) { this.root = path.resolve(root); }

  async init() { await fs.mkdir(this.root, { recursive: true }); }

  runDir(runId) { return path.join(this.root, safeSegment(runId)); }

  async write(runId, name, value) {
    const safe = typeof value === 'string' ? redactText(value) : redactSensitive(value);
    return writeImmutable(this.runDir(runId), name, typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2));
  }

  async appendEvent(runId, event) {
    const dir = this.runDir(runId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'events.jsonl');
    const line = JSON.stringify(redactSensitive(event));
    await fs.appendFile(file, line + '\n');
    return { file, sha256: await sha256(file), eventSha256: crypto.createHash('sha256').update(line).digest('hex') };
  }

  async manifest(runId, items = []) {
    const out = [];
    for (const item of items) out.push({ ...item, sha256: await sha256(path.resolve(item.file)) });
    return this.write(runId, 'manifest.json', { schema: 'aecp.evidence/v1', runId, createdAt: new Date().toISOString(), items: out });
  }

  verify(ref) { return verifyEvidenceRef(ref, this.root); }

  // Verifies the manifest file itself and every item it lists.
  async verifyManifest(ref) {
    const own = await this.verify(ref);
    if (!own.ok) return { ok: false, reason: own.reason, items: [] };
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(ref.file, 'utf8')); } catch { return { ok: false, reason: 'BAD_MANIFEST', items: [] }; }
    const items = [];
    for (const item of manifest.items || []) items.push({ file: item.file, ...(await verifyEvidenceRef(item)) });
    return { ok: items.every((item) => item.ok), reason: items.every((item) => item.ok) ? 'OK' : 'ITEM_MISMATCH', items };
  }
}

module.exports = { EvidenceManager, writeImmutable, verifyEvidenceRef, safeSegment, sha256 };
