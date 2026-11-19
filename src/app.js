// Builds the Express application. Storage and repository are passed in
// (dependency injection), so tests can use temporary folders and a future
// Azure version can pass Blob/Cosmos adapters instead.
const express = require('express');
const path = require('path');
const multer = require('multer');
const { createVideoRouter } = require('./routes/videos');

function createApp({ repo, storage, maxUploadMb = 100 }) {
  const app = express();

  app.use(express.json({ limit: '50kb' }));

  // Health endpoint: used by Docker, CI and later by Azure health checks / load balancers.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use('/api/videos', createVideoRouter({ repo, storage, maxUploadMb }));

  // Video files. express.static supports HTTP Range requests, so the browser
  // can stream and seek through a video instead of downloading it all first.
  app.use('/media', express.static(storage.dir, { maxAge: '1h' }));

  // Front end (plain HTML/CSS/JS).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Unknown API routes -> JSON 404
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Video is larger than the ${maxUploadMb} MB limit`
        : err.message;
      return res.status(status).json({ error: message });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
  });

  return app;
}

module.exports = { createApp };
