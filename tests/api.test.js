// Automated API tests (Jest + Supertest). These run locally with `npm test`
// and automatically in the GitHub Actions CI pipeline on every push.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createLocalStorage } = require('../src/storage/localStorage');
const { createJsonRepository } = require('../src/data/jsonRepository');

let app;
let tmp;
// A few bytes is enough: the server checks the MIME type, not the content.
const fakeVideo = Buffer.from('00000018667479706d703432', 'hex');

beforeEach(async () => {
  // Every test gets its own empty storage folder and database file.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reelhive-test-'));
  const storage = createLocalStorage(path.join(tmp, 'uploads'));
  const repo = createJsonRepository(path.join(tmp, 'videos.json'));
  await storage.init();
  await repo.init();
  app = createApp({ repo, storage, maxUploadMb: 1 });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function uploadVideo(title = 'My first reel') {
  return request(app)
    .post('/api/videos')
    .field('title', title)
    .field('creator', 'tester')
    .attach('video', fakeVideo, { filename: 'clip.mp4', contentType: 'video/mp4' });
}

describe('health', () => {
  test('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('videos API', () => {
  test('starts with an empty list', async () => {
    const res = await request(app).get('/api/videos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('uploads a video and lists it', async () => {
    const created = await uploadVideo();
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: 'My first reel', creator: 'tester', likes: 0 });
    expect(created.body.url).toMatch(/^\/media\//);
    expect(created.body.storageKey).toBeUndefined();

    const list = await request(app).get('/api/videos');
    expect(list.body).toHaveLength(1);
  });

  test('uploaded file can be streamed with a Range request', async () => {
    const { body } = await uploadVideo();
    const res = await request(app).get(body.url).set('Range', 'bytes=0-3');
    expect(res.status).toBe(206);
  });

  test('rejects an upload with no file', async () => {
    const res = await request(app).post('/api/videos').field('title', 'x');
    expect(res.status).toBe(400);
  });

  test('rejects an upload with no title', async () => {
    const res = await request(app)
      .post('/api/videos')
      .attach('video', fakeVideo, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
  });

  test('rejects files that are not videos', async () => {
    const res = await request(app)
      .post('/api/videos')
      .field('title', 'not a video')
      .attach('video', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
  });

  test('rejects files over the size limit', async () => {
    const big = Buffer.alloc(1024 * 1024 + 10);
    const res = await request(app)
      .post('/api/videos')
      .field('title', 'too big')
      .attach('video', big, { filename: 'big.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(413);
  });

  test('likes, views and comments update the video', async () => {
    const { body } = await uploadVideo();
    await request(app).post(`/api/videos/${body.id}/like`).expect(200);
    await request(app).post(`/api/videos/${body.id}/view`).expect(200);
    await request(app)
      .post(`/api/videos/${body.id}/comments`)
      .send({ author: 'sam', text: 'Great clip!' })
      .expect(201);

    const res = await request(app).get(`/api/videos/${body.id}`);
    expect(res.body.likes).toBe(1);
    expect(res.body.views).toBe(1);
    expect(res.body.comments[0]).toMatchObject({ author: 'sam', text: 'Great clip!' });
  });

  test('popular sort orders by likes', async () => {
    const a = (await uploadVideo('A')).body;
    const b = (await uploadVideo('B')).body;
    await request(app).post(`/api/videos/${b.id}/like`);
    const res = await request(app).get('/api/videos?sort=popular');
    expect(res.body.map((v) => v.id)).toEqual([b.id, a.id]);
  });

  test('unlike reduces likes but never below zero', async () => {
    const { body } = await uploadVideo();
    await request(app).post(`/api/videos/${body.id}/like`);
    let res = await request(app).post(`/api/videos/${body.id}/unlike`).expect(200);
    expect(res.body.likes).toBe(0);
    res = await request(app).post(`/api/videos/${body.id}/unlike`).expect(200);
    expect(res.body.likes).toBe(0);
  });

  test('search finds videos by title, creator or #tag', async () => {
    await request(app).post('/api/videos').field('title', 'Cooking pasta').field('description', 'quick dinner #food')
      .attach('video', fakeVideo, { filename: 'a.mp4', contentType: 'video/mp4' });
    await uploadVideo('Morning run');
    expect((await request(app).get('/api/videos?q=%23food')).body).toHaveLength(1);
    expect((await request(app).get('/api/videos?q=PASTA')).body).toHaveLength(1);
    expect((await request(app).get('/api/videos?q=tester')).body).toHaveLength(1);
    expect((await request(app).get('/api/videos?q=nothing-matches')).body).toHaveLength(0);
  });

  test('deletes a video and its file', async () => {
    const { body } = await uploadVideo();
    await request(app).delete(`/api/videos/${body.id}`).expect(204);
    await request(app).get(`/api/videos/${body.id}`).expect(404);
    await request(app).get(body.url).expect(404);
  });

  test('unknown video id returns 404', async () => {
    await request(app).post('/api/videos/does-not-exist/like').expect(404);
  });
});
