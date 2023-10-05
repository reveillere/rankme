import express from 'express';
import morgan from 'morgan'
import cors from 'cors';
import router from './routes.js';

const app = express();
const port = 80;

app.use(cors());
app.use(morgan('dev'));
app.use(router);

app.listen(port, () => {
  console.log(`Server is running ...`);
});
