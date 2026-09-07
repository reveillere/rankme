import express from 'express';
import morgan from 'morgan'
import cors from 'cors';
import router from './routes.js';
import fs from 'fs';
import * as sjr from './sjrPortal.js';
import * as core from './corePortal.js'
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
  app.listen(port, () => {
    console.log(`Server is running ...`);
  });
}

start();

