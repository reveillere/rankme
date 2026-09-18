import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { ObjectId } from 'mongodb';
import { getClient } from './db.js';

const SESSION_COOKIE = 'rankme_session';
const SESSION_DAYS = 30;
// 128 bits of randomness -- far beyond brute-force reach, so the code can be
// hashed with plain SHA-256 (unlike a human password, it needs no deliberately
// slow KDF such as bcrypt/argon2).
const CODE_BYTES = 16;
// Starting point: reclaim accounts nobody has touched in 30 days, to keep
// storage bounded now that anyone can create one for free with no identity
// check. Revisit if that turns out too aggressive/lax in practice.
const INACTIVITY_DAYS = 30;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters');
  return value;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

export function createSessionToken(userId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ userId: String(userId), exp: now + SESSION_DAYS * 24 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token, now = Date.now()) {
  if (!token) return null;
  const [payload, signature] = String(token).split('.');
  const expected = payload ? sign(payload) : '';
  if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.exp > now && parsed.userId ? parsed : null;
  } catch { return null; }
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim().split('=')) .filter(([key, value]) => key && value).map(([key, ...value]) => [key, value.join('=')]));
}

function cookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}${maxAge === 0 ? '; Max-Age=0' : `; Max-Age=${maxAge}`}`;
}

function configured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32);
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Accepts codes pasted back with the display dashes still in them.
function normalizeCode(input) {
  return String(input || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function formatCode(hex) {
  return hex.match(/.{1,4}/g).join('-');
}

// Purely cosmetic, user-chosen, never verified -- just so someone with
// several devices can tell accounts apart. Strip control characters and cap
// the length; empty means "no label".
function sanitizeLabel(input) {
  const label = String(input || '').replace(/[\p{Cc}]/gu, '').trim().slice(0, 60);
  return label || null;
}

let indexesReady;
async function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = (async () => {
      const client = await getClient();
      const db = client.db('rankme');
      await db.collection('users').createIndex({ codeHash: 1 }, { unique: true });
      // TTL index: MongoDB itself reaps a user doc once lastActiveAt is more
      // than INACTIVITY_DAYS old -- no cron job needed for the account side.
      await db.collection('users').createIndex({ lastActiveAt: 1 }, { expireAfterSeconds: INACTIVITY_DAYS * 24 * 60 * 60 });
      await db.collection('userState').createIndex({ userId: 1 }, { unique: true });
    })().catch(error => { indexesReady = undefined; throw error; });
  }
  return indexesReady;
}

async function userCollection() {
  await ensureIndexes();
  const client = await getClient();
  return client.db('rankme').collection('users');
}

async function stateCollection() {
  await ensureIndexes();
  const client = await getClient();
  return client.db('rankme').collection('userState');
}

// In-memory, per-process de-dupe (same spirit as rateLimit.js) so an active
// user's every request doesn't turn into a write -- one DB touch per user
// per day is plenty to keep the 30-day TTL accurate.
const ACTIVITY_THROTTLE_MS = 24 * 60 * 60 * 1000;
const lastTouched = new Map();

async function touchActivity(userId) {
  const now = Date.now();
  if (now - (lastTouched.get(userId) || 0) < ACTIVITY_THROTTLE_MS) return;
  lastTouched.set(userId, now);
  if (!ObjectId.isValid(userId)) return;
  const users = await userCollection();
  await users.updateOne({ _id: new ObjectId(userId) }, { $set: { lastActiveAt: new Date() } });
}

export function requireUser(req, res, next) {
  let session;
  try { session = verifySessionToken(cookies(req)[SESSION_COOKIE]); } catch { session = null; }
  if (!session) return res.status(401).json({ error: 'Unauthorized', message: 'Create or sign in to a sync account to use account synchronization.' });
  req.user = session;
  // Fire-and-forget: this is a side effect, not part of the response --
  // it must never slow down or fail the actual request.
  touchActivity(session.userId).catch(error => console.error('[Auth] Activity touch failed:', error.message));
  return next();
}

function startSession(res, userId) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${createSessionToken(userId)}; ${cookieOptions(SESSION_DAYS * 24 * 60 * 60)}`);
}

// No email, username or third-party identity provider is ever collected --
// the random code itself is the only credential, so the account carries no
// personal data at all. Only its SHA-256 hash is stored; the raw code is
// returned once and never recoverable if lost.
export async function controllerRegister(req, res) {
  if (!configured()) return res.status(503).json({ error: 'Sync is not configured' });
  const code = crypto.randomBytes(CODE_BYTES).toString('hex');
  const label = sanitizeLabel(req.body?.label);
  const users = await userCollection();
  const now = new Date();
  const result = await users.insertOne({ codeHash: hashCode(code), label, createdAt: now, lastActiveAt: now });
  startSession(res, result.insertedId);
  return res.json({ code: formatCode(code), label });
}

export async function controllerLogin(req, res) {
  if (!configured()) return res.status(503).json({ error: 'Sync is not configured' });
  const code = normalizeCode(req.body?.code);
  if (code.length !== CODE_BYTES * 2) return res.status(400).json({ error: 'Bad Request', message: 'Invalid sync code' });
  const users = await userCollection();
  const user = await users.findOne({ codeHash: hashCode(code) });
  if (!user) return res.status(401).json({ error: 'Unauthorized', message: 'Unknown sync code' });
  await users.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } });
  startSession(res, user._id);
  return res.json({ ok: true });
}

export async function controllerMe(req, res) {
  let session;
  try { session = verifySessionToken(cookies(req)[SESSION_COOKIE]); } catch { session = null; }
  if (!session) return res.json({ signedIn: false, available: configured() });
  let label = null;
  if (ObjectId.isValid(session.userId)) {
    const users = await userCollection();
    const user = await users.findOne({ _id: new ObjectId(session.userId) }, { projection: { label: 1 } });
    label = user?.label || null;
  }
  return res.json({ signedIn: true, available: configured(), label });
}

export async function controllerUpdateLabel(req, res) {
  if (!ObjectId.isValid(req.user.userId)) return res.status(400).json({ error: 'Bad Request' });
  const label = sanitizeLabel(req.body?.label);
  const users = await userCollection();
  await users.updateOne({ _id: new ObjectId(req.user.userId) }, { $set: { label } });
  return res.json({ label });
}

export function controllerLogout(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(0)}`);
  return res.status(204).end();
}

function gzipToBase64(text) {
  return zlib.gzipSync(Buffer.from(text, 'utf8')).toString('base64');
}

function gunzipBase64(base64) {
  return zlib.gunzipSync(Buffer.from(base64, 'base64')).toString('utf8');
}

export async function controllerGetState(req, res) {
  const states = await stateCollection();
  const state = await states.findOne({ userId: req.user.userId });
  const values = state?.values || {};
  const updatedAt = state?.updatedAt || null;
  // gzip is opt-in per request (CompressionStream isn't universal) -- the
  // legacy plain-JSON shape stays the default for callers that don't ask.
  if (req.query.gzip) return res.json({ version: 1, gzip: gzipToBase64(JSON.stringify(values)), updatedAt });
  return res.json({ version: 1, values, updatedAt });
}

// Defense in depth, mirroring front/src/preferences.js's isPreferenceKey()
// plus 'rankme:teams' (see front/src/accountSync.js) -- keep both lists in
// sync. Without this, the server would blindly store whatever the caller
// sends: harmless as long as the front end's own allowlist holds, but a
// single future front-end bug (e.g. a new rankme:*-prefixed secret added
// without updating that allowlist) would silently sync it to every device
// signed into the account. This second, independent filter stops that
// regardless of what the front end does.
const SYNCED_KEYS = new Set(['rankme:conferenceSource', 'rankme:journalSource', 'rankme:filterCategories', 'rankme:customRankings', 'rankme:matchOverrides', 'rankme:useCommunityOverrides', 'rankme:identityLinks', 'rankme:crosscheckDecisions', 'rankme:teams']);
const SYNCED_KEY_PREFIX = 'rankme:filterRanks:';

function isSyncedKey(key) {
  return SYNCED_KEYS.has(key) || Boolean(key?.startsWith(SYNCED_KEY_PREFIX));
}

export async function controllerPutState(req, res) {
  let input;
  if (typeof req.body?.gzip === 'string') {
    try { input = JSON.parse(gunzipBase64(req.body.gzip)); }
    catch { return res.status(400).json({ error: 'Bad Request', message: 'Invalid compressed payload' }); }
  } else {
    input = req.body?.values;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: 'Bad Request', message: 'values must be an object' });
  const values = Object.fromEntries(Object.entries(input).filter(([key]) => isSyncedKey(key)));
  const json = JSON.stringify(values);
  if (json.length > 10_000_000) return res.status(413).json({ error: 'Payload Too Large', message: 'Synchronized state is limited to 10 MB' });
  const states = await stateCollection();
  const updatedAt = new Date();
  await states.updateOne({ userId: req.user.userId }, { $set: { userId: req.user.userId, values, updatedAt } }, { upsert: true });
  if (req.body?.gzip) return res.json({ version: 1, gzip: gzipToBase64(json), updatedAt });
  return res.json({ version: 1, values, updatedAt });
}

// MongoDB's TTL monitor deletes expired `users` docs on its own, but doesn't
// know about `userState` -- it's a separate collection with no foreign-key
// relationship. Sweep periodically to reclaim the sync blobs of accounts
// that already expired, rather than leaving them behind forever.
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function scheduleAccountCleanup() {
  const run = async () => {
    try {
      const users = await userCollection();
      const states = await stateCollection();
      const activeIds = (await users.distinct('_id')).map(String);
      const { deletedCount } = await states.deleteMany({ userId: { $nin: activeIds } });
      if (deletedCount) console.log(`[Auth] Removed ${deletedCount} sync state(s) belonging to expired accounts`);
    } catch (error) {
      console.error('[Auth] Account cleanup failed:', error.message);
    }
  };
  run();
  return setInterval(run, CLEANUP_INTERVAL_MS);
}

export const authCookieNames = { SESSION_COOKIE };
