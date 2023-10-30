import express from 'express';
import * as dblp from './dblp.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
import * as admin from './admin.js';

const router = express.Router();
    
router.get('/dblp/author/*', dblp.controllerAuthor);
router.get('/dblp/search/*', dblp.controllerSearch);
router.get('/dblp/venue/*', dblp.controllerVenue);

router.get('/rank/db/conf/*', core.controllerRank);
router.get('/rank/db/journals/*', sjr.controllerRank);

router.get('/admin/venues', admin.controllerVenues);

export default router;




