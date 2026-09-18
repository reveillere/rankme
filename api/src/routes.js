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

const router = express.Router();

// Applied only to the expensive cross-check/team-resolution routes below --
// generous enough (30 req/min per IP) not to bother normal browser use, just
// to stop a runaway script or scraper from hammering the costliest
// computations in the app. See rateLimit.js.
const costlyRouteLimit = rateLimit({ windowMs: 60_000, max: 30 });

// Liveness probe for Docker healthchecks: confirms the Express process is
// up and responsive. Deliberately doesn't touch DBLP/HAL/mongo/redis, so it
// won't false-positive as unhealthy just because an upstream is degraded.
router.get('/health', (req, res) => res.json({ status: 'ok' }));

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
// costlyRouteLimit here too, not just on the crosscheck/team-family routes
// below: since recordPresentation.js started ranking/correcting every
// record on this path (see respondWithRecords), the POST branch is no
// longer the cheap "just the display name" lookup the GET compat route
// above still is.
router.post('/dblp/author/*', requireApiToken, costlyRouteLimit, dblp.controllerAuthor);
router.get('/dblp/author-info/*', dblp.controllerAuthorInfo);
router.get('/dblp/search/*', dblp.controllerSearch);
router.get('/dblp/author-stream/*', authorStream.controllerDblpAuthor);

router.post('/hal/author/:idHal', requireApiToken, costlyRouteLimit, hal.controllerAuthor);
router.get('/hal/author-info/*', hal.controllerAuthorInfo);
router.get('/hal/search/*', hal.controllerSearch);
router.get('/hal/author-stream/*', authorStream.controllerHalAuthor);

router.post('/hal/structure/:structId', requireApiToken, costlyRouteLimit, hal.controllerStructurePublications);
router.get('/hal/structure-search/*', hal.controllerSearchStructure);
router.get('/hal/structure-info/*', hal.controllerStructureInfo);
router.get('/hal/structure-stream/*', authorStream.controllerHalStructure);
router.post('/records/team', requireApiToken, costlyRouteLimit, controllerTeamRecords);

// Read-only automatic suggestions. Personal link CRUD lives in localStorage.
router.get('/identity/structure/:structId', costlyRouteLimit, identityResolution.controllerResolveStructure);
router.post('/identity/team', costlyRouteLimit, identityResolution.controllerResolveTeam);
router.get('/identity/suggest/*', identityResolution.controllerSuggestIdentity);
router.get('/identity/suggest-dblp/:idHal', identityResolution.controllerSuggestDblpIdentity);

router.get('/rank/core/candidates', core.controllerCandidates);
router.get('/rank/sjr/candidates', sjr.controllerCandidates);
router.get('/rank/ccf/candidates', ccf.controllerCandidates);

router.post('/match-overrides', matchOverrides.controllerRecord);
router.get('/match-overrides/shared/:portal', matchOverrides.controllerSharedList);

router.get('/crosscheck/author/*', costlyRouteLimit, crosscheck.controllerCrossCheck);
router.post('/crosscheck/author', requireApiToken, costlyRouteLimit, crosscheck.controllerCrossCheck);
router.get('/crosscheck/structure/:structId', costlyRouteLimit, crosscheckStructure.controllerCrossCheckStructure);
router.post('/crosscheck/structure', requireApiToken, costlyRouteLimit, crosscheckStructure.controllerCrossCheckStructure);
// POST, not GET .../*: a team's member list (dblp pids) comes from the
// client's own localStorage (front/src/teamStore.js -- the server has no
// notion of a team at all) and can be long, so it travels in the body
// rather than a query string the way a single wildcard id does above.
router.post('/crosscheck/team', requireApiToken, costlyRouteLimit, crosscheckTeam.controllerCrossCheckTeam);
// Browser calculation with request-scoped links; no shared identity writes.
router.post('/internal/crosscheck/structure', costlyRouteLimit, crosscheckStructure.controllerCrossCheckStructure);
router.post('/internal/crosscheck/team', costlyRouteLimit, crosscheckTeam.controllerCrossCheckTeam);

// requireAdminToken added here: this triggers a full drop + rebuild of
// every DBLP collection (see admin.js's processXML) -- CPU/memory/disk
// heavy and, until now, callable by anyone who found the URL.
router.get('/admin/venues', admin.requireAdminToken, admin.controllerVenues);
router.get('/admin/stats', admin.requireAdminToken, admin.controllerStats);
router.get('/admin/metrics', admin.requireAdminToken, admin.controllerPrometheusMetrics);

export default router;
