import express from 'express';
import * as dblp from './dblp.js';
import * as core from './corePortal.js';

const router = express.Router();

router.get('/core/rank', core.controllerRank);

router.get('/dblp/author/*', dblp.fetchAuthor);
router.get('/dblp/search/author/:query', dblp.searchAuthor);
router.get('/dblp/venue/*', dblp.getVenueTitle);

export default router;
