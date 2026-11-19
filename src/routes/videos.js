// REST API for videos (resource-based URLs and HTTP verbs, as in the Week 2 REST lecture).
//
//   GET    /api/videos              list videos (?sort=new|popular)
//   GET    /api/videos/:id          one video
//   POST   /api/videos              upload (multipart form: video, title, description, creator)
//   POST   /api/videos/:id/like     add a like
//   POST   /api/videos/:id/view     count a view
//   POST   /api/videos/:id/comments add a comment  { author, text }
//   DELETE /api/videos/:id          delete video and its file
const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs/promises');
const path = require('path');

const MIME_BY_EXT = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
};
const VIDEO_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

function toDto(video, storage) {
  // Never expose internal fields like storageKey; give the client a playable URL instead.
  const { storageKey, ...rest } = video;
  return { ...rest, url: storage.publicUrl(storageKey) };
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function createVideoRouter({ repo, storage, maxUploadMb }) {
  const router = express.Router();

  const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      // Accept a video MIME type, or a known video extension (some browsers/tools
      // send a generic "application/octet-stream" type for valid videos).
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (file.mimetype.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return cb(null, true);
      const err = new Error('Only video files can be uploaded');
      err.status = 415;
      cb(err);
    },
  });

  router.get('/', async (req, res) => {
    const sort = req.query.sort === 'popular' ? 'popular' : 'new';
    const videos = await repo.list({ sort });
    res.json(videos.map((v) => toDto(v, storage)));
  });

  router.get('/:id', async (req, res) => {
    const video = await repo.get(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json(toDto(video, storage));
  });

  router.post('/', upload.single('video'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'A video file is required' });
    const title = clean(req.body.title, 100);
    if (!title) {
      await fs.unlink(req.file.path).catch(() => {}); // discard the temp upload
      return res.status(400).json({ error: 'A title is required' });
    }
    const storageKey = await storage.save(req.file.path, req.file.originalname);
    const video = await repo.create({
      title,
      description: clean(req.body.description, 300),
      creator: clean(req.body.creator, 40) || 'anonymous',
      storageKey,
      mimeType: req.file.mimetype.startsWith('video/')
        ? req.file.mimetype
        : MIME_BY_EXT[path.extname(req.file.originalname).toLowerCase()] || 'video/mp4',
      sizeBytes: req.file.size,
    });
    res.status(201).location(`/api/videos/${video.id}`).json(toDto(video, storage));
  });

  router.post('/:id/like', async (req, res) => {
    const video = await repo.update(req.params.id, (v) => { v.likes += 1; });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json({ id: video.id, likes: video.likes });
  });

  router.post('/:id/view', async (req, res) => {
    const video = await repo.update(req.params.id, (v) => { v.views += 1; });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json({ id: video.id, views: video.views });
  });

  router.post('/:id/comments', async (req, res) => {
    const text = clean(req.body?.text, 300);
    if (!text) return res.status(400).json({ error: 'Comment text is required' });
    const comment = {
      author: clean(req.body?.author, 40) || 'anonymous',
      text,
      createdAt: new Date().toISOString(),
    };
    const video = await repo.update(req.params.id, (v) => { v.comments.push(comment); });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.status(201).json(comment);
  });

  router.delete('/:id', async (req, res) => {
    const video = await repo.remove(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    await storage.remove(video.storageKey);
    res.status(204).end();
  });

  return router;
}

module.exports = { createVideoRouter };
