import express from 'express';
import morgan from 'morgan'
import cors from 'cors';
import router from './routes.js';
import fs from 'fs';
import * as sjr from './sjrPortal.js';
import * as core from './corePortal.js'
import * as ccf from './ccfPortal.js';
import * as metrics from './metrics.js';

const accessLogStream = fs.createWriteStream('./log/access.log', { flags: 'a' });



const app = express();
const port = 80;

app.use(cors());
app.use(morgan('dev', { stream: accessLogStream }));
app.use(express.json());
app.use(metrics.middleware);
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

