import express from 'express';
import morgan from 'morgan'
import cors from 'cors';
import router from './routes.js';
import fs from 'fs';

const accessLogStream = fs.createWriteStream('./logs/access.log', { flags: 'a' });

const app = express();
const port = 80;

app.use(cors());
app.use(morgan('dev', { stream: accessLogStream }));
app.use(router);

app.listen(port, () => {
  console.log(`Server is running ...`);
});
