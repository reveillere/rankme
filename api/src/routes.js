import express from 'express';
import * as dblp from './dblp.js';
import * as hal from './hal.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import * as ccf from './ccfPortal.js';
import * as admin from './admin.js';
import { requireApiToken } from './apiToken.js';
import { rateLimit } from './rateLimit.js';
import * as authorStream from './authorStream.js';
import * as matchOverrides from './matchOverrides.js';
import * as crosscheck from './crosscheck.js';
import * as crosscheckStructure from './crosscheckStructure.js';
import * as crosscheckTeam from './crosscheckTeam.js';
import * as identityResolution from './identityResolution.js';
import { controllerTeamRecords } from './teamRecords.js';
import * as auth from './auth.js';

const router = express.Router();

// Only the documented, token-protected public API is rate-limited.
// Browser-internal identity and cross-check routes do not consume this quota.
const publicApiLimit = rateLimit({ windowMs: 60_000, max: 30 });

// Liveness probe for Docker healthchecks: confirms the Express process is
// up and responsive. Deliberately doesn't touch DBLP/HAL/mongo/redis, so it
// won't false-positive as unhealthy just because an upstream is degraded.
router.get('/health', (req, res) => res.json({ status: 'ok' }));

// Browser-only anonymous sync accounts (a random code is the sole
// credential -- no email/username/third-party identity ever collected) and
// per-user localStorage synchronization. These do not use the public API
// token, but register/login get their own tight limiter since the code is
// a password-equivalent secret with no username to lock out.
const authLimit = rateLimit({ windowMs: 60_000, max: 10 });
router.post('/auth/register', authLimit, auth.controllerRegister);
router.post('/auth/login', authLimit, auth.controllerLogin);
router.get('/auth/me', auth.controllerMe);
router.post('/auth/logout', auth.controllerLogout);
router.put('/auth/label', auth.requireUser, auth.controllerUpdateLabel);
router.get('/sync/state', auth.requireUser, auth.controllerGetState);
router.put('/sync/state', auth.requireUser, auth.controllerPutState);

// For SettingsDialog.js's ranking-source descriptions -- reads each
// portal's own live in-process state (core.getLatestSource/
// sjr.getLatestYear/ccf.getLatestEditionYear), so it's always accurate
// after an update rather than a string someone has to remember to bump by
// hand. coreYears/sjrYears are additive (RankDetailsPopover.js's custom-
// ranking "also apply to these years" picker, see corePortal.js/
// sjrPortal.js) -- existing fields untouched so this stays a drop-in for
// SettingsDialog.js's own pre-existing fetch.
router.get('/ranking-editions', async (req, res) => {
  const latestCore = await core.getLatestSource();
  res.json({
    core: latestCore?.source ?? null, sjr: sjr.getLatestYear(), ccf: ccf.getLatestEditionYear(),
    coreYears: await core.getAllYears(), sjrYears: sjr.getYearRange(),
  });
});

router.get('/dblp/status', admin.controllerDblpStatus);
// Browser-internal compatibility routes. They are deliberately omitted from
// OpenAPI; the documented API uses the protected POST endpoints below.
router.get('/dblp/author/*', dblp.controllerAuthor);
// Public records endpoints are limited too: since recordPresentation.js started ranking/correcting every
// record on this path (see respondWithRecords), the POST branch is no
// longer the cheap "just the display name" lookup the GET compat route
// above still is.
router.post('/dblp/author/*', requireApiToken, publicApiLimit, dblp.controllerAuthor);
router.get('/dblp/author-info/*', dblp.controllerAuthorInfo);
router.get('/dblp/search/*', dblp.controllerSearch);
router.get('/dblp/author-stream/*', authorStream.controllerDblpAuthor);

router.post('/hal/author/:idHal', requireApiToken, publicApiLimit, hal.controllerAuthor);
router.get('/hal/author-info/*', hal.controllerAuthorInfo);
router.post('/hal/author-infos', hal.controllerAuthorInfos);
router.get('/hal/search/*', hal.controllerSearch);
router.get('/hal/author-stream/*', authorStream.controllerHalAuthor);

router.post('/hal/structure/:structId', requireApiToken, publicApiLimit, hal.controllerStructurePublications);
router.get('/hal/structure-search/*', hal.controllerSearchStructure);
router.get('/hal/structure-info/*', hal.controllerStructureInfo);
router.get('/hal/structure-stream/*', authorStream.controllerHalStructure);
router.post('/records/team', requireApiToken, publicApiLimit, controllerTeamRecords);

// Read-only automatic suggestions. Personal link CRUD lives in localStorage.
router.get('/identity/structure/:structId', identityResolution.controllerResolveStructure);
router.post('/identity/team', identityResolution.controllerResolveTeam);
router.get('/identity/suggest/*', identityResolution.controllerSuggestIdentity);
router.get('/identity/suggest-dblp/:idHal', identityResolution.controllerSuggestDblpIdentity);

router.get('/rank/core/candidates', core.controllerCandidates);
router.get('/rank/sjr/candidates', sjr.controllerCandidates);
router.get('/rank/ccf/candidates', ccf.controllerCandidates);

router.post('/match-overrides', matchOverrides.controllerRecord);
router.get('/match-overrides/shared/:portal', matchOverrides.controllerSharedList);

router.get('/crosscheck/author/*', crosscheck.controllerCrossCheck);
router.post('/crosscheck/author', requireApiToken, publicApiLimit, crosscheck.controllerCrossCheck);
router.get('/crosscheck/structure/:structId', crosscheckStructure.controllerCrossCheckStructure);
router.post('/crosscheck/structure', requireApiToken, publicApiLimit, crosscheckStructure.controllerCrossCheckStructure);
// POST, not GET .../*: a team's member list (dblp pids) comes from the
// client's own localStorage (front/src/teamStore.js -- the server has no
// notion of a team at all) and can be long, so it travels in the body
// rather than a query string the way a single wildcard id does above.
router.post('/crosscheck/team', requireApiToken, publicApiLimit, crosscheckTeam.controllerCrossCheckTeam);
// Browser calculation with request-scoped links; no shared identity writes.
router.post('/internal/crosscheck/structure', crosscheckStructure.controllerCrossCheckStructure);
router.post('/internal/crosscheck/team', crosscheckTeam.controllerCrossCheckTeam);

// requireAdminToken added here: this triggers a full drop + rebuild of
// every DBLP collection (see admin.js's processXML) -- CPU/memory/disk
// heavy and, until now, callable by anyone who found the URL.
router.get('/admin/venues', admin.requireAdminToken, admin.controllerVenues);
router.get('/admin/stats', admin.requireAdminToken, admin.controllerStats);
router.get('/admin/metrics', admin.requireAdminToken, admin.controllerPrometheusMetrics);

export default router;
