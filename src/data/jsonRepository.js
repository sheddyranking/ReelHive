// Metadata repository: keeps video records in a JSON file.
//
// It mimics a document database. Each video is one JSON document, much like
// an item in a Cosmos DB container (Week 4). A cosmosRepository.js with the
// same functions could replace it without touching the routes.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function createJsonRepository(dataFile) {
  let videos = [];
  let writing = Promise.resolve();

  async function init() {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    try {
      videos = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    } catch {
      videos = [];
      await persist();
    }
  }

  // Write to a temp file then rename, so a crash never leaves a half-written file.
  // Writes are queued so two requests cannot overwrite each other.
  function persist() {
    writing = writing.then(async () => {
      const tmp = `${dataFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(videos, null, 2));
      await fs.rename(tmp, dataFile);
    });
    return writing;
  }

  async function list({ sort = 'new', q = '' } = {}) {
    // Simple case-insensitive search over title, description (incl. #tags) and creator
    const term = q.trim().toLowerCase();
    const copy = term
      ? videos.filter((v) => `${v.title} ${v.description} ${v.creator}`.toLowerCase().includes(term))
      : [...videos];
    if (sort === 'popular') {
      copy.sort((a, b) => b.likes - a.likes || b.views - a.views);
    } else {
      copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return copy;
  }

  async function get(id) {
    return videos.find((v) => v.id === id) || null;
  }

  async function create(fields) {
    const video = {
      id: crypto.randomUUID(),
      title: fields.title,
      description: fields.description || '',
      creator: fields.creator || 'anonymous',
      storageKey: fields.storageKey,
      mimeType: fields.mimeType,
      sizeBytes: fields.sizeBytes,
      likes: 0,
      views: 0,
      comments: [],
      createdAt: new Date().toISOString(),
    };
    videos.push(video);
    await persist();
    return video;
  }

  async function update(id, changeFn) {
    const video = await get(id);
    if (!video) return null;
    changeFn(video);
    await persist();
    return video;
  }

  async function remove(id) {
    const video = await get(id);
    if (!video) return null;
    videos = videos.filter((v) => v.id !== id);
    await persist();
    return video;
  }

  return { init, list, get, create, update, remove };
}

module.exports = { createJsonRepository };
