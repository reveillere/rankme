import express from 'express';
import * as dblp from './dblp.js';
import * as hal from './hal.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import * as admin from './admin.js';
import * as authorStream from './authorStream.js';

const router = express.Router();

// Liveness probe for Docker healthchecks: confirms the Express process is
// up and responsive. Deliberately doesn't touch DBLP/HAL/mongo/redis, so it
// won't false-positive as unhealthy just because an upstream is degraded.
router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.get('/dblp/author/*', dblp.controllerAuthor);
router.get('/dblp/search/*', dblp.controllerSearch);
router.get('/dblp/venue/*', dblp.controllerVenue);
router.get('/dblp/author-stream/*', authorStream.controllerDblpAuthor);

router.get('/hal/author/*', hal.controllerAuthor);
router.get('/hal/search/*', hal.controllerSearch);
router.get('/hal/author-stream/*', authorStream.controllerHalAuthor);

router.get('/rank/db/conf/*', core.controllerRank);
router.get('/rank/db/journals/*', sjr.controllerRank);

router.get('/admin/venues', admin.controllerVenues);


router.post('/rank/db/conf2', core.controllerRank2);
router.post('/rank/db/journals2', sjr.controllerRank2);



export default router;




