'use strict';

// Share-link store + password hashing + signed-cookie helpers.
// A "share" maps a UUID token -> { slug, version, pass, label } and grants
// public access to exactly that game version once the password is entered.
//
// CLI:
//   node auth.js add <slug> [version] [--pass <password>]
//   node auth.js list
//   node auth.js rm <token>

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = process.env.SHARES_FILE || '/data/shares.json';
const SECRET = process.env.SHARE_SECRET || '';

// --- store (cached by mtime so per-request reads are cheap) ---------------
let cache = { mtime: -1, data: {} };

function load() {
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (m !== cache.mtime) cache = { mtime: m, data: JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    return cache.data;
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  cache.mtime = -1; // invalidate
}

// --- passwords (scrypt) ---------------------------------------------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// --- signed cookie (HMAC over a list of granted tokens) -------------------
function sign(tokens) {
  const payload = Buffer.from(JSON.stringify(tokens)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function unsign(value) {
  if (!value || !SECRET) return [];
  const [payload, mac] = String(value).split('.');
  if (!payload || !mac) return [];
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return [];
  try {
    const arr = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// --- share management (shared by CLI and admin UI) ------------------------
function createShare({ slug, version = 'current', password, label }) {
  const pw = password || crypto.randomBytes(9).toString('base64url');
  const token = crypto.randomUUID();
  const data = load();
  data[token] = {
    slug, version, pass: hashPassword(pw), label: label || slug, created: new Date().toISOString(),
  };
  save(data);
  return { token, password: pw };
}

function removeShare(token) {
  const data = load();
  if (!data[token]) return false;
  delete data[token];
  save(data);
  return true;
}

module.exports = {
  load, save, hashPassword, verifyPassword, sign, unsign, createShare, removeShare, FILE,
};

// --- CLI ------------------------------------------------------------------
if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const shares = load();

  if (cmd === 'add') {
    const args = rest.filter((a) => !a.startsWith('--'));
    const slug = args[0];
    const version = args[1] || 'current';
    if (!slug) { console.error('usage: add <slug> [version] [--pass <password>]'); process.exit(1); }
    const passIdx = rest.indexOf('--pass');
    const { token, password } = createShare({
      slug, version, password: passIdx >= 0 ? rest[passIdx + 1] : undefined,
    });
    const base = process.env.PUBLIC_URL || '';
    console.log('Share created:');
    console.log(`  game:     ${slug}@${version}`);
    console.log(`  url:      ${base}/s/${token}`);
    console.log(`  password: ${password}`);
  } else if (cmd === 'list') {
    for (const [token, s] of Object.entries(shares)) {
      console.log(`${token}  ${s.slug}@${s.version}  (${s.label || ''})`);
    }
  } else if (cmd === 'rm') {
    const token = rest[0];
    if (!shares[token]) { console.error('no such token'); process.exit(1); }
    delete shares[token];
    save(shares);
    console.log('removed', token);
  } else {
    console.error('commands: add <slug> [version] [--pass <pw>] | list | rm <token>');
    process.exit(1);
  }
}
