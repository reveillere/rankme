import { isPreferenceKey } from './preferences.js';

// Allowlist, not a denylist: anything not listed here (e.g. rankme:adminToken,
// rankme:api-token) stays local-only and is never sent to the server.
const EXTRA_SYNCED_KEYS = new Set(['rankme:teams']);

function syncable(key) {
  return isPreferenceKey(key) || EXTRA_SYNCED_KEYS.has(key);
}

export function collectSyncState() {
  const values = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!syncable(key)) continue;
    const raw = localStorage.getItem(key);
    try { values[key] = JSON.parse(raw); } catch { values[key] = raw; }
  }
  return values;
}

export function applySyncState(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  for (const key of Object.keys(values)) {
    if (!syncable(key)) continue;
    const value = values[key];
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  window.dispatchEvent(new Event('rankme:preferenceschange'));
  window.dispatchEvent(new Event('rankme:customrankingchange'));
  window.dispatchEvent(new Event('rankme:overridechange'));
  window.dispatchEvent(new CustomEvent('rankme:personaldatachange'));
  window.dispatchEvent(new CustomEvent('rankme:teamchange'));
}

export async function getCurrentUser() {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Account request failed (${response.status})`);
  return await response.json();
}

// Creates a brand-new anonymous sync account. The returned code is the only
// credential and the only way back in -- the server never stores or shows
// it again, so the caller must have the user save it before moving on.
// label is purely cosmetic (helps tell devices/accounts apart) and optional.
export async function registerAccount(label) {
  const response = await fetch('/api/auth/register', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error(`Registration failed (${response.status})`);
  return await response.json();
}

export async function loginWithCode(code) {
  const response = await fetch('/api/auth/login', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (response.status === 401 || response.status === 400) return false;
  if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
  return true;
}

export async function updateLabel(label) {
  const response = await fetch('/api/auth/label', {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error(`Label update failed (${response.status})`);
  return (await response.json()).label;
}

// Preference/team data compresses very well (lots of repeated structure
// across the many rankme:filterRanks:* entries) -- gzip it over the wire
// when the browser supports it, with a plain-JSON fallback otherwise.
const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

function bufferToBase64(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function gzipToBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return bufferToBase64(await new Response(stream).arrayBuffer());
}

async function gunzipFromBase64(base64) {
  const stream = new Blob([base64ToBuffer(base64)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export async function syncNow() {
  if (syncing) return null;
  syncing = true;
  try {
    const current = await fetch(`/api/sync/state${canGzip ? '?gzip=1' : ''}`, { credentials: 'same-origin' });
    if (current.status === 401) return null;
    if (!current.ok) throw new Error(`Sync request failed (${current.status})`);
    const currentPayload = await current.json();
    const remote = currentPayload.gzip ? JSON.parse(await gunzipFromBase64(currentPayload.gzip)) : (currentPayload.values || {});
    const local = collectSyncState();
    // Keep existing browser data on first sign-in, while filling keys from a
    // previously used device. The merged snapshot becomes the account source.
    const merged = { ...remote, ...local };
    applySyncState(merged);
    const body = canGzip ? { gzip: await gzipToBase64(JSON.stringify(merged)) } : { values: merged };
    const response = await fetch('/api/sync/state', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Sync update failed (${response.status})`);
    return merged;
  } finally {
    syncing = false;
  }
}

let syncTimer;
let syncing = false;
export function scheduleSync() {
  if (syncing) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), 800);
}

export function startAccountSync() {
  const events = ['rankme:preferenceschange', 'rankme:customrankingchange', 'rankme:overridechange', 'rankme:personaldatachange', 'rankme:teamchange'];
  const handler = () => scheduleSync();
  events.forEach(event => window.addEventListener(event, handler));
  return () => events.forEach(event => window.removeEventListener(event, handler));
}
