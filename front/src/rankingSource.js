// Which ranking source computes a publication's rank -- now two
// independent choices, one per axis: conferences (CORE, the default, or
// CCF) and journals (SJR, the default, or CCF). They used to be a single
// combined toggle ('core-sjr' vs 'ccf', pre-0.6.0) since CCF happened to
// rank both on one shared A/B/C scale -- but that made it impossible to,
// say, keep CORE for conferences while trying CCF for journals. Splitting
// them means CCF can now be picked per axis instead of as an all-or-nothing
// swap. Unlike e.g. getUseCommunityOverrides (a one-off preference read
// fresh only where needed), these ARE part of FilterSettingsContext --
// switching either needs to be visible everywhere at once (the toolbar
// badge, the category filters, every open tab's stream) without a page
// reload, which a plain localStorage read can't do on its own. This file
// stays the actual persistence layer (get/set/validate); the context is
// what makes changes to it propagate live.
//
// getProfile (aliased below): only customRankings.js -> matchOverrides.js/
// corePortal.js/sjrPortal.js, so this one-way import (needed by
// rankingQueryParams, see its own comment) doesn't create a cycle back here.
import { getProfile as getCustomProfile } from './customRankings';

const CONFERENCE_STORAGE_KEY = 'rankme:conferenceSource';
const JOURNAL_STORAGE_KEY = 'rankme:journalSource';

// Pre-0.6.0 single-toggle key -- read once below (migrateLegacySource) to
// carry an existing 'ccf' choice forward into both new axes, then never
// touched again.
const LEGACY_STORAGE_KEY = 'rankme:rankingSource';

// label is for the Settings radio (where "(default)" is useful context);
// shortLabel is for RankingSourceIndicator's toolbar badge, where the
// current tab's own ranking source is what matters, not whether it happens
// to be the default one.
export const CONFERENCE_SOURCES = {
  'core': { label: 'CORE (default)', shortLabel: 'CORE' },
  'ccf': { label: 'CCF', shortLabel: 'CCF' },
};

export const JOURNAL_SOURCES = {
  'sjr': { label: 'SJR (default)', shortLabel: 'SJR' },
  'ccf': { label: 'CCF', shortLabel: 'CCF' },
};

// A `custom:${profileId}` value (customRankings.js's own profiles) is
// accepted here -- exported so FilterSettingsContext.js (choosing the right
// rank vocabulary/palette per axis) and each container (deriving
// activeCustomProfileIds, see customProfileIdFrom below) can recognize one
// without duplicating the 'custom:' convention.
export function isCustomSource(value) {
  return typeof value === 'string' && value.startsWith('custom:') && value.length > 'custom:'.length;
}

// The bare profile id out of a `custom:${profileId}` source value, or null
// for anything else (including CORE/SJR/CCF) -- the one place that knows
// the 'custom:' prefix convention, so a container computing
// activeCustomProfileIds (RankBadge.js's activeCustomProfileId, per axis)
// doesn't need its own copy of it.
export function customProfileIdFrom(source) {
  return isCustomSource(source) ? source.slice('custom:'.length) : null;
}

function getSource(storageKey, sources, defaultValue) {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored && (stored in sources || isCustomSource(stored)) ? stored : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setSource(storageKey, value) {
  try { localStorage.setItem(storageKey, value); } catch { /* best-effort */ }
}

// Silent one-time migration: someone who had picked 'ccf' under the old
// single-toggle key gets both new axes defaulted to 'ccf' too, so their
// choice doesn't silently revert to CORE+SJR the first time they load
// 0.6.0. Nothing to do for the old default ('core-sjr' or unset) -- the new
// per-axis defaults (CORE, SJR) already match it. Runs once at module load;
// guarded on both new keys being entirely unset so it never overwrites a
// choice already made under the new scheme.
(function migrateLegacySource() {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== 'ccf') return;
    if (localStorage.getItem(CONFERENCE_STORAGE_KEY) != null || localStorage.getItem(JOURNAL_STORAGE_KEY) != null) return;
    localStorage.setItem(CONFERENCE_STORAGE_KEY, 'ccf');
    localStorage.setItem(JOURNAL_STORAGE_KEY, 'ccf');
  } catch { /* best-effort */ }
})();

export function getConferenceSource() {
  return getSource(CONFERENCE_STORAGE_KEY, CONFERENCE_SOURCES, 'core');
}

export function setConferenceSource(value) {
  setSource(CONFERENCE_STORAGE_KEY, value);
}

export function getJournalSource() {
  return getSource(JOURNAL_STORAGE_KEY, JOURNAL_SOURCES, 'sjr');
}

export function setJournalSource(value) {
  setSource(JOURNAL_STORAGE_KEY, value);
}

// A custom:* source has no query-param notion of its own -- the server has
// never heard of customRankings.js's profiles -- but it still needs telling
// confSource/journalSource=ccf when the profile's own *reference* ranking is
// 'ccf', or the server would silently compute CORE/SJR as the axis's base
// instead, breaking a "custom ranking on top of CCF" profile entirely (the
// automatically-computed rank customRankings.js's getEffectiveCustomValue
// falls back to for anything not explicitly overridden would just be the
// wrong ranking). A 'core'/'sjr' reference (or a profile that's been
// deleted -- getProfile returns null) needs no param, same as today's plain
// CORE/SJR default.
function ccfParamNeeded(source, getReference) {
  if (source === 'ccf') return true;
  const profileId = customProfileIdFrom(source);
  return profileId ? getReference(profileId) === 'ccf' : false;
}

// Appended to a streaming endpoint's URL (Author.js/AuthorHal.js/
// Structure.js/Team.js, via useFilterSettings()'s live `conferenceSource`/
// `journalSource` -- not read from storage directly here, so that a change
// actually produces a new URL string and re-triggers the stream, instead of
// only taking effect after a reload) -- authorStream.js's confSourceFrom/
// journalSourceFrom read these same 'confSource'/'journalSource' query
// params server-side.
export function rankingQueryParams({ conferenceSource, journalSource }) {
  const params = [];
  if (ccfParamNeeded(conferenceSource, (id) => getCustomProfile(id)?.reference)) params.push('confSource=ccf');
  if (ccfParamNeeded(journalSource, (id) => getCustomProfile(id)?.reference)) params.push('journalSource=ccf');
  return params.length ? `?${params.join('&')}` : '';
}
