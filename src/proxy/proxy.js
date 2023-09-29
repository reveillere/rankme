import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';

const app = express();
const port = 3000;

app.use(cors());


app.use('/core', createProxyMiddleware({
  target: 'http://portal.core.edu.au',
  changeOrigin: true,
  pathRewrite: {
    '^/core': ''
  },
  onProxyReq: (proxyReq, req) => {
    // Check if the path is missing a trailing slash and is not a file
    if (!/\/$/.test(proxyReq.path) && !/\.\w+$/.test(proxyReq.path)) {
      proxyReq.path += '/'; // Append the trailing slash to the path
    }
    console.log(`Rewritten URL: ${req.originalUrl} -> ${proxyReq.path}`);
  },
  onError: (err, req, res) => {
    console.error(`Error in proxy: ${err.message}`);
  }
}));


app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
});