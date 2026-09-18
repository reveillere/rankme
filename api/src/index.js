import express from 'express';
import morgan from 'morgan'
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import router from './routes.js';
import { openapiSpec } from './openapi.js';
import fs from 'fs';
import * as sjr from './sjrPortal.js';
import * as core from './corePortal.js'
import * as ccf from './ccfPortal.js';
import * as metrics from './metrics.js';
import { scheduleAccountCleanup } from './auth.js';

const accessLogStream = fs.createWriteStream('./log/access.log', { flags: 'a' });



const app = express();
const port = 80;

// Browser CORS only, not a security boundary for the token-authenticated
// public API (server-to-server callers never send an Origin header at
// all, so this can't restrict them) -- it just stops arbitrary third-party
// web pages from making cross-origin calls, including to /admin/*. The
// front end itself is same-origin (served by the same reverse proxy, see
// reverse-proxy/nginx.conf.prod), so it never needs this to be open.
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin) {
  console.log('[CORS] No CORS_ORIGIN set — allowing all origins');
}
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map(o => o.trim()) } : undefined));
app.use(morgan('dev', { stream: accessLogStream }));
// Default body-parser limit is 100kb -- too small for /api/sync/state,
// which documents (and enforces) up to 10MB of synchronized browser data.
app.use(express.json({ limit: '11mb' }));
app.use(metrics.middleware);
app.get('/openapi.json', (req, res) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'RankMe API documentation' }));
app.use(router);

// Loaded before the server starts accepting connections, not in the
// listen() callback: listen() already binds the port and starts serving
// requests before that callback fires, so a rank lookup landing during
// load() would previously see an empty/partial collection and — since the
// result got cached — stay wrong long after loading finished.
async function start() {
  await sjr.load();
  await core.load();
  // Unlike sjr/core above, ccf.load() never throws (CCF is an opt-in
  // alternative ranking source, not the default -- see its own comment):
  // a failed fetch with no local snapshot just leaves it empty, so this
  // can't fail startup the way the other two deliberately do.
  await ccf.load();
  scheduleAccountCleanup();
  app.listen(port, () => {
    console.log(`Server is running ...`);
  });
}

// Both load()s now throw if they end up with no usable data at all (see
// their own comments) -- letting that reject here and crash the process
// (rather than swallowing it and calling listen() anyway) is deliberate:
// docker-compose.prod.yml's `restart: always` just keeps retrying until
// the network/Mongo dependency actually recovers, instead of the app
// quietly coming up with CORE/SJR ranking broken for everyone.
start().catch((error) => {
  console.error('Fatal startup error:', error.message);
  process.exit(1);
});
