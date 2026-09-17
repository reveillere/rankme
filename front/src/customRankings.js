import * as CorePortal from './corePortal.js';
import * as SjrPortal from './sjrPortal.js';
import * as CcfPortal from './ccfPortal.js';
import { getEffectiveValue, resolveEffectiveValue, csvEscape, parseCSV } from './matchOverrides.js';

const STORAGE_KEY = 'rankme:customRankings';

// Same in-memory-cache-plus-`storage`-event pattern as matchOverrides.js,
// for the same reason: a large publication list can call
// getDisplayValue/getEffectiveCustomValue below once per row on every
// render, and a fresh localStorage.getItem + JSON.parse per call is exactly
// the cost matchOverrides.js's own comment on this measured as multiple
// seconds of main-thread time at LaBRI scale.
let cachedProfiles = null;

function read() {
  if (cachedProfiles) return cachedProfiles;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    cachedProfiles = raw && typeof raw === 'object' ? raw : {};
  } catch {
    cachedProfiles = {};
  }
  return cachedProfiles;
}

try {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) cachedProfiles = null;
  });
} catch { /* non-browser env */ }

function write(profiles) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // storage full/unavailable -- profiles are best-effort, ignore
  }
  cachedProfiles = profiles;
  notifyChange();
}

// A dedicated event, not matchOverrides.js's 'rankme:overridechange': a
// custom ranking edit and a match correction are different things a
// container needs to react to independently (see
// useOverrideRefreshTick.js, which now listens for both) -- e.g. deleting
// the profile currently selected as an axis's active source needs
// FilterSettingsContext.js to notice and fall back, which has nothing to
// do with match overrides at all.
function notifyChange() {
  try { window.dispatchEvent(new Event('rankme:customrankingchange')); } catch { /* non-browser env */ }
}

// The letter vocabulary a profile's own reference ranking actually uses --
// CORE's A*/A/B/C/Misc/Unranked, SJR's Q1-Q4/Unranked, or CCF's A/B/C/
// Unranked. RankDetailsPopover.js's letter-chip picker and
// FilterSettingsContext.js's `ranks` (rank-filter checkboxes, RankSummary/
// RanksByYearChart legend) both key off this per profile, instead of a
// blanket merge of every reference's letters regardless of which one a
// given profile actually has -- a CORE-referenced profile has no use for
// Q1-Q4 (nothing it covers can ever take that value), any more than plain
// CORE itself would. Unrecognized/missing falls back to CORE's own set,
// the same default createProfile itself uses when asked for an invalid
// reference.
export function ranksForReference(reference) {
  if (reference === 'sjr') return SjrPortal.ranks;
  if (reference === 'ccf') return CcfPortal.ranks;
  return CorePortal.ranks;
}

// Which entry a (portal, rank) pair belongs to. Identity, not the
// (edition, exact text) pair matchOverrides.js's own keyFor uses: a custom
// ranking's whole point is "this conference, every year", so it has to
// survive across editions the way a match correction (scoped to fixing one
// specific automatic guess) doesn't need to. override?.candidate?.id first:
// a personal match correction changes *what* a venue text actually refers
// to, so it should also redirect which custom entry applies to it -- the
// two mechanisms compose instead of needing their own separate identity
// concept. Falls back to the automatic match's own matchedId, and finally
// to the raw query text when neither exists (e.g. a venue CORE/SJR has
// simply never matched at all) -- see this module's own CCF-only limitation
// noted where it's actually surfaced (customRankings dialog/plan notes).
function effectiveIdentity(portal, rank, override) {
  return override?.candidate?.id ?? rank?.matchedId ?? null;
}

// Exported: RankDetailsPopover.js needs this to let a user clear a custom
// entry outright (see MyCustomRankingsDialog.js for the same lookup, kept
// in sync by hand the way matchOverrides.js's own CSV import already
// duplicates its keyFor inline rather than exporting it just for that).
export function entryKeyFor(portal, rank, override) {
  const id = effectiveIdentity(portal, rank, override);
  return id != null ? `${portal}:id:${id}` : `${portal}:text:${rank?.queryText}`;
}

export function listProfiles() {
  return Object.values(read()).sort((a, b) => a.name.localeCompare(b.name));
}

// Pure core of getProfile below, `profiles` (the {[id]: profile} shape
// read()/write() persist) passed in explicitly -- same reasoning as
// matchOverrides.js's own resolveOverride: lets api/src/recordPresentation.js
// run the exact same resolution against a caller-supplied customRankings
// JSON payload, nothing stored server-side.
export function resolveProfile(profiles, profileId) {
  if (!profileId) return null;
  return profiles[profileId] || null;
}

export function getProfile(profileId) {
  return resolveProfile(read(), profileId);
}

// Which axis (or axes) a profile's own reference makes it eligible for --
// CORE never ranks journals and SJR never ranks conferences, so a profile
// referencing either is confined to the matching axis the same way plain
// CORE/SJR already are (see rankingSource.js's CONFERENCE_SOURCES/
// JOURNAL_SOURCES); CCF ranks both, so a CCF-referenced profile can be
// picked on either, like plain CCF itself. Shared by SettingsDialog.js
// (which radio options to offer per axis) and MyCustomRankingsDialog.js
// (labeling each profile's own row) so the two can't drift on what
// "eligible" means.
export function axesForReference(reference) {
  if (reference === 'core') return ['conference'];
  if (reference === 'sjr') return ['journal'];
  return ['conference', 'journal'];
}

const REFERENCES = ['core', 'sjr', 'ccf'];

// reference: which automatic ranking this profile starts from for anything
// it hasn't explicitly overridden -- 'core', 'sjr', or 'ccf', chosen once
// here and immutable afterward (no rename-the-reference UI exists, and none
// is planned: changing it after entries exist would silently redefine what
// every "untouched" venue in the profile displays). Required, no default --
// MyCustomRankingsDialog.js's create form always passes one; a profile is
// meaningless without it now that getEffectiveCustomValue falls back to the
// reference's own value instead of a blanket 'Unranked' (see below). Also
// gates which axis(es) the profile can be selected on: SettingsDialog.js
// only lists a 'core'/'ccf' profile under Conferences, 'sjr'/'ccf' under
// Journals -- mirroring the fact that CORE never ranks journals and SJR
// never ranks conferences, while CCF (like today's plain CCF option) covers
// both.
export function createProfile(name, reference) {
  if (!REFERENCES.includes(reference)) throw new Error(`Invalid reference ranking: ${reference}`);
  const profiles = read();
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const profile = { id, name: (name || '').trim() || 'Untitled ranking', reference, createdAt: Date.now(), updatedAt: Date.now(), entries: {} };
  profiles[id] = profile;
  write(profiles);
  return profile;
}

export function renameProfile(profileId, name) {
  const profiles = read();
  const profile = profiles[profileId];
  if (!profile) return;
  const trimmed = (name || '').trim();
  if (trimmed) profile.name = trimmed;
  profile.updatedAt = Date.now();
  write(profiles);
}

// Deleting the profile currently active for an axis is expected and
// harmless -- FilterSettingsContext.js listens for the
// 'rankme:customrankingchange' this write() dispatches and falls back that
// axis to its default (decision 5), rather than this function needing to
// know or care who might be pointing at profileId.
export function deleteProfile(profileId) {
  const profiles = read();
  delete profiles[profileId];
  write(profiles);
}

// A profile is "its reference ranking, with specific venues/editions
// overridden" -- not a blank slate starting at 'Unranked' everywhere. Every
// fallback here (no profile at all, no entry for this venue, no value for
// this specific edition) reads `rank?.value` instead: `rank` is already the
// automatically-computed reference-ranking result for this exact axis
// (CORE/SJR/CCF -- whichever the server actually resolved, per
// rankingSource.js's rankingQueryParams sending confSource/journalSource=ccf
// only when the profile's own reference is 'ccf'), so its own `.value` IS
// the reference ranking's answer for anything not explicitly touched --
// no separate fetch needed. Still 'Unranked' as the final fallback for the
// rare case `rank` itself is missing entirely.
export function resolveEffectiveCustomValue(profiles, profileId, portal, rank, override, year) {
  const profile = resolveProfile(profiles, profileId);
  if (!profile) return { value: rank?.value ?? 'Unranked', hasEntry: false };
  const entry = profile.entries[entryKeyFor(portal, rank, override)];
  if (!entry) return { value: rank?.value ?? 'Unranked', hasEntry: false };
  // Object property access coerces `year` to a string either way (dblp's
  // own year arrives as a string, HAL's as a number -- see
  // authorStream.js), so byEdition's own keys (always strings, from
  // JSON/localStorage) match regardless of which shape the caller has. A
  // specific year always wins over 'ALL' -- decision 4.
  const value = entry.byEdition[year] ?? entry.byEdition['ALL'];
  return value != null ? { value, hasEntry: true } : { value: rank?.value ?? 'Unranked', hasEntry: false };
}

export function getEffectiveCustomValue(profileId, portal, rank, override, year) {
  return resolveEffectiveCustomValue(read(), profileId, portal, rank, override, year);
}

// applyToAllEditions writes only the 'ALL' key; otherwise `year` (the
// publication's own year, always included) plus whatever
// alsoApplyToYears names get the same value -- decision 4's "apply by
// default to the current year, with an explicit picker for others".
// title/acronym are kept for MyCustomRankingsDialog.js's own listing (a
// human-readable label for the entry) -- refreshed from whichever of
// override/rank actually has a name this time, never blanked back to null
// by a later call that happens not to (e.g. resolveHalVenueAcronym not
// finding an acronym on a subsequent publication of the same venue).
export function setEntry({ profileId, portal, rank, override, year, value, applyToAllEditions, alsoApplyToYears }) {
  const profiles = read();
  const profile = profiles[profileId];
  if (!profile) return null;
  const key = entryKeyFor(portal, rank, override);
  const candidateId = effectiveIdentity(portal, rank, override);
  const title = override?.candidate?.title || rank?.matchedTitle || null;
  const acronym = override?.candidate?.acronym || rank?.matchedAcronym || null;
  const entry = profile.entries[key] || { key, portal, candidateId, queryText: rank?.queryText ?? null, title, acronym, byEdition: {} };
  entry.candidateId = candidateId;
  entry.title = title ?? entry.title;
  entry.acronym = acronym ?? entry.acronym;
  const years = applyToAllEditions ? ['ALL'] : [...new Set([String(year), ...(alsoApplyToYears || []).map(String)])];
  for (const y of years) entry.byEdition[y] = value;
  profile.entries[key] = entry;
  profile.updatedAt = Date.now();
  write(profiles);
  return entry;
}

export function deleteEntryEdition(profileId, entryKey, year) {
  const profiles = read();
  const entry = profiles[profileId]?.entries?.[entryKey];
  if (!entry) return;
  delete entry.byEdition[String(year)];
  // No editions left at all -- an entry with an empty byEdition is
  // meaningless (getEffectiveCustomValue would just report it as
  // unranked/no-entry anyway), so drop it outright rather than leaving an
  // empty husk MyCustomRankingsDialog.js would still have to list.
  if (Object.keys(entry.byEdition).length === 0) delete profiles[profileId].entries[entryKey];
  profiles[profileId].updatedAt = Date.now();
  write(profiles);
}

export function deleteEntry(profileId, entryKey) {
  const profiles = read();
  const profile = profiles[profileId];
  if (!profile?.entries?.[entryKey]) return;
  delete profile.entries[entryKey];
  profile.updatedAt = Date.now();
  write(profiles);
}

export function clearProfileEntries(profileId) {
  const profiles = read();
  const profile = profiles[profileId];
  if (!profile) return;
  profile.entries = {};
  profile.updatedAt = Date.now();
  write(profiles);
}

// Maps a rank's own portal ('core'/'sjr'/'ccf', from matchOverrides.js's
// portalFromRank) to the {conference, journal} axis it belongs to, so
// Statistics.js/RankSummary.js (which iterate a mixed list and only know
// each item's portal, not which axis it came from) don't need their own
// copy of "core is conferences, sjr is journals". 'ccf' never resolves to a
// profile: a custom ranking's silent base is always CORE/SJR (decision 2),
// so a rank actually sourced from CCF can only mean that axis picked plain
// CCF, not a custom profile -- there's no scenario where both are true for
// the same axis at once.
export function customProfileIdForPortal(activeCustomProfileIds, portal) {
  if (portal === 'core') return activeCustomProfileIds?.conference ?? null;
  if (portal === 'sjr') return activeCustomProfileIds?.journal ?? null;
  return null;
}

// Single entry point for "what value does this rank actually display",
// mirroring matchOverrides.js's own getEffectiveValue but custom-ranking
// aware -- delegates straight to it when customProfileId is empty, so every
// existing (non-custom) caller keeps exactly today's behavior byte for
// byte. RankBadge.js/RankSummary.js/Statistics.js all funnel through this
// now instead of calling getEffectiveValue directly.
// Pure core, `overrides`/`profiles` passed in explicitly -- same reasoning
// as resolveProfile/resolveEffectiveCustomValue above. api/src/recordPresentation.js
// is the only caller that needs this form; every front-end one keeps using
// getDisplayValue (unchanged below), which already has its own localStorage
// read wired in via getEffectiveValue/getEffectiveCustomValue.
export function resolveDisplayValue(overrides, profiles, rank, { portal, sharedMap, customProfileId, override, year } = {}) {
  if (!rank) return undefined;
  if (!customProfileId) return resolveEffectiveValue(overrides, rank, sharedMap);
  return resolveEffectiveCustomValue(profiles, customProfileId, portal, rank, override, year).value;
}

export function getDisplayValue(rank, { portal, sharedMap, customProfileId, override, year } = {}) {
  if (!rank) return undefined;
  if (!customProfileId) return getEffectiveValue(rank, sharedMap);
  return getEffectiveCustomValue(customProfileId, portal, rank, override, year).value;
}

const CSV_COLUMNS = ['profileId', 'profileName', 'reference', 'portal', 'candidateId', 'queryText', 'title', 'acronym', 'edition', 'value'];

// One row per (profile, venue, edition) triple -- a multi-edition entry
// (byEdition holding several years, or 'ALL') expands to several rows, same
// idea as matchOverrides.js's one-row-per-correction export but one level
// more granular, since a single entry here can carry several distinct
// values across editions where a match correction never has more than one.
// `reference` is repeated on every row (rather than, say, a one-off header
// row) so a re-import can recover it the same way profileName already is,
// without needing a second, differently-shaped section in the same file.
function profileRows(profile) {
  const rows = [];
  for (const entry of Object.values(profile.entries)) {
    for (const [edition, value] of Object.entries(entry.byEdition)) {
      rows.push([
        profile.id, profile.name, profile.reference, entry.portal, entry.candidateId ?? '', entry.queryText ?? '',
        entry.title ?? '', entry.acronym ?? '', edition, value,
      ]);
    }
  }
  return rows;
}

export function profileToCSV(profileId) {
  const profile = getProfile(profileId);
  const rows = profile ? profileRows(profile) : [];
  return [CSV_COLUMNS.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\r\n');
}

export function allProfilesToCSV() {
  const rows = listProfiles().flatMap(profileRows);
  return [CSV_COLUMNS.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\r\n');
}

// For MyCustomRankingsDialog.js's confirm-name step (see importProfilesFromCSV's
// own nameOverride comment below): a quick look at the CSV's own
// profileName column, before the user has committed to importing anything,
// to seed the TextField with a reasonable starting point instead of making
// them type a name from scratch. Reuses parseCSV rather than a naive
// split(',') for the same reason importProfilesFromCSV does -- profileName
// (a user-typed name) can itself contain a comma. '' (not null/undefined)
// when the file is empty, malformed, or has no profileName column at all,
// so callers can treat it as a plain TextField default value.
export function peekProfileNameFromCSV(text) {
  try {
    const rows = parseCSV(text);
    if (rows.length < 2) return '';
    const idx = rows[0].indexOf('profileName');
    return idx === -1 ? '' : (rows[1][idx] || '');
  } catch {
    return '';
  }
}

// Re-imported rows keep their original profileId -- so exporting a profile,
// deleting it, and re-importing the same file recreates it under the exact
// same id rather than a new one, which matters if that id is still named by
// a stale `custom:${id}` source value somewhere (localStorage on another
// tab/device, e.g.) that would otherwise stay broken even after the import.
// A profileId not already present locally is created fresh from the row's
// own profileName rather than rejected -- the common case (importing onto a
// browser that never had this profile at all).
//
// nameOverride (MyCustomRankingsDialog.js's confirm-name step, so importing
// never silently names a profile from whatever text happened to be in the
// CSV's own profileName column) only applies to a profile this import is
// actually *creating* -- never to one already present locally, which would
// turn what's meant to be a data merge into a surprise rename. It's also
// only applied when the file introduces exactly one new profileId: the
// common case is re-importing a single "export this profile" file, where
// that's unambiguous; a multi-profile "export all" file re-imported onto a
// browser with none of them yet would have no principled way to pick which
// of several new profiles a single typed name belongs to, so it's ignored
// entirely in that case and every row's own profileName is kept instead.
export function importProfilesFromCSV(text, { nameOverride } = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) return 0;
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ['profileId', 'profileName', 'reference', 'portal', 'edition', 'value'];
  const missing = required.filter(r => !(r in idx));
  if (missing.length > 0) throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);

  const profiles = read();
  const cell = (row, col) => (idx[col] != null ? row[idx[col]] : '');
  const newProfileIds = new Set(
    rows.slice(1).map(row => cell(row, 'profileId')).filter(id => id && !profiles[id])
  );
  const trimmedOverride = (nameOverride || '').trim();
  const applyNameOverride = !!trimmedOverride && newProfileIds.size === 1;

  let count = 0;
  for (const row of rows.slice(1)) {
    const get = (col) => cell(row, col);
    const profileId = get('profileId');
    const portal = get('portal');
    const edition = get('edition');
    const value = get('value');
    if (!profileId || !portal || !edition || !value) continue;

    // reference is only read when this row is the first one establishing a
    // *new* profile (an existing one keeps whatever it already has, same as
    // profileName just below it never being re-applied per row either) --
    // a row for a profile already present locally shouldn't be able to
    // silently mutate its reference out from under it.
    const reference = REFERENCES.includes(get('reference')) ? get('reference') : 'core';
    const profile = profiles[profileId] || {
      id: profileId,
      name: (applyNameOverride ? trimmedOverride : get('profileName')) || 'Imported ranking',
      reference, createdAt: Date.now(), updatedAt: Date.now(), entries: {},
    };
    const candidateId = get('candidateId') || null;
    const queryText = get('queryText') || null;
    // Same rule as entryKeyFor above, inlined rather than called: this runs
    // against a CSV's own columns (candidateId/queryText already split
    // apart), not a live (rank, override) pair to derive an identity from.
    const key = candidateId ? `${portal}:id:${candidateId}` : `${portal}:text:${queryText}`;
    const entry = profile.entries[key] || { key, portal, candidateId, queryText, title: get('title') || null, acronym: get('acronym') || null, byEdition: {} };
    entry.byEdition[edition] = value;
    profile.entries[key] = entry;
    profiles[profileId] = profile;
    count++;
  }
  write(profiles);
  return count;
}

// JSON sibling of profileToCSV/allProfilesToCSV -- unlike the CSV export
// (one flattened row per profile/venue/edition triple, needed for a
// spreadsheet), a profile's own `entries` object already IS the natural
// JSON shape, so this exports the plain profile object(s) directly, no
// flattening/reconstruction needed. Also what the public API's own
// customRankings request parameter expects (openapi.js) --
// api/src/recordPresentation.js runs parseProfilesJSON directly against a
// caller-supplied file, nothing stored server-side.
export function profileToJSON(profileId) {
  return JSON.stringify(getProfile(profileId), null, 2);
}

export function allProfilesToJSON() {
  return JSON.stringify(listProfiles(), null, 2);
}

// Pure parse: JSON text (one profile object, or an array of them) -> the
// {[id]: profile} map resolveProfile/resolveEffectiveCustomValue expect --
// validated but never touching localStorage, shared by
// importProfilesFromJSON below (front) and the API (reads it directly).
export function parseProfilesJSON(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const profiles = {};
  for (const profile of list) {
    if (!profile?.id || !REFERENCES.includes(profile.reference)) continue;
    profiles[profile.id] = { entries: {}, ...profile };
  }
  return profiles;
}

// Whole-profile upsert by id -- simpler than importProfilesFromCSV's
// per-entry merge (that one has to reconstruct a profile from flattened
// rows one at a time; here the file already carries each profile's
// complete `entries` object, so replacing it wholesale is both simpler and
// what a re-imported "export this profile" file should do anyway).
export function importProfilesFromJSON(text) {
  const parsed = parseProfilesJSON(text);
  const profiles = read();
  let count = 0;
  for (const [id, profile] of Object.entries(parsed)) {
    profiles[id] = profile;
    count++;
  }
  write(profiles);
  return count;
}
