# ReelHive

ReelHive is a short-video sharing web app, built for **COM769 Scalable Advanced Software Solutions, Coursework 2** (Ulster University, 2026/27).

Users can upload short videos, scroll through a vertical feed, like videos, comment on them and delete them. This first version runs on **localhost**. The code is structured so the local storage and database can be swapped for Azure services in the next stage.

## Features (current version)

- Upload a video (MP4, WebM, MOV) with a title, caption and creator name, plus an upload progress bar
- Vertical, snap-scrolling feed. Videos autoplay muted when on screen; click to unmute or pause
- Video streaming with HTTP Range requests, so the browser can seek without downloading the whole file
- "For you" (newest first) and "Popular" (most liked) feeds
- Likes, view counts and comments
- Delete a video, which removes both the record and the file
- REST API with input validation (file type, file size, required title)
- Automated tests and a CI workflow on GitHub Actions
- Dockerfile and docker-compose for container deployment

## Run it locally

You need **Node.js 20 or newer** (`node -v` to check).

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

`npm run dev` also works. It restarts the server automatically whenever a file changes.

### Run the tests

```bash
npm test
```

### Run with Docker

```bash
docker compose up --build
```

Then open http://localhost:3000. Uploaded videos are kept on the `reelhive-data` Docker volume.

### Settings (environment variables, all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `UPLOAD_DIR` | `./uploads` | Where video files are stored |
| `DATA_FILE` | `./data/videos.json` | Where video metadata is stored |
| `MAX_UPLOAD_MB` | `100` | Maximum upload size |

## Architecture

```
 Browser (HTML/CSS/JS)
        │  REST (JSON) + video streaming (HTTP Range)
        ▼
 Express web/API server  ──────────────►  Media storage adapter   (local disk now → Azure Blob Storage)
   src/app.js, routes/   ──────────────►  Metadata repository     (JSON file now  → Azure Cosmos DB)
```

The server is **stateless**: videos and metadata live in the storage adapter and the repository, not in the server's memory. Once those are moved to Azure Blob Storage and Cosmos DB, several copies of the web server can run behind a load balancer and the app can scale out horizontally.

The storage adapter and the repository are passed into the app (dependency injection, in `src/app.js`). Moving to Azure therefore means writing two new adapters with the same functions. The API routes and front end stay as they are.

## REST API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/videos?sort=new\|popular` | List videos |
| GET | `/api/videos/:id` | Get one video |
| POST | `/api/videos` | Upload (multipart: `video`, `title`, `description`, `creator`) |
| POST | `/api/videos/:id/like` | Like a video |
| POST | `/api/videos/:id/view` | Count a view |
| POST | `/api/videos/:id/comments` | Add a comment (`{ author, text }`) |
| DELETE | `/api/videos/:id` | Delete a video and its file |

## Project structure

```
src/
  server.js                 entry point: wires the adapters and starts the server
  app.js                    Express app, static files, error handling
  config.js                 settings from environment variables
  routes/videos.js          REST API for videos
  storage/localStorage.js   media storage adapter (local disk)
  data/jsonRepository.js    metadata repository (JSON file)
public/                     front end (index.html, styles.css, app.js)
tests/api.test.js           automated API tests (Jest + Supertest)
.github/workflows/ci.yml    CI pipeline: test, then Docker build
Dockerfile, docker-compose.yml
```

## Roadmap (next stages for CW2)

- [ ] Azure Blob Storage adapter for video files
- [ ] Azure Cosmos DB adapter for metadata
- [ ] Deploy to Azure App Service (or Azure Container Apps) from the CI/CD pipeline (continuous delivery)
- [ ] Autoscaling and a staging deployment slot (advanced deployment topology)
- [ ] CDN for video delivery
- [ ] Performance profiling (Application Insights) and optimisation
- [ ] Advanced features, e.g. user sign-in (identity), AI content analysis, captions/transcription
- [ ] Pricing estimate with the Azure Pricing Calculator

## Acknowledgement

Parts of this project were developed with help from a generative AI tool (Claude, by Anthropic). This use is acknowledged in line with Ulster University's guidance on the use of AI in assessment.
