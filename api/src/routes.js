import express from 'express';
import * as dblp from './dblp.js';
import * as core from './corePortal.js';
import * as sjr from './sjrPortal.js';
 
const router = express.Router();
    

const coreStats = [];
const sjrStats = [];

function statsMiddleware(statsArray) {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const endTime = Date.now();
      const elapsedTime = endTime - startTime;

      statsArray.push({
        path: req.path,
        method: req.method,
        status: res.statusCode,
        responseTime: elapsedTime
      });
    });

    next();
  };
}

router.get('/core/rank', statsMiddleware(coreStats), core.controllerRank);

router.get('/dblp/author/*', dblp.fetchAuthor);
router.get('/dblp/search/author/:query', dblp.searchAuthor);
router.get('/dblp/venue/*', dblp.getVenueTitle);

router.get('/sjr/rank', statsMiddleware(sjrStats), sjr.controllerRank);

router.get('/stats/core', (req, res) => {
    res.json(coreStats);
  });
  
  router.get('/stats/sjr', (req, res) => {
    res.json(sjrStats);
  });
  
export default router;
