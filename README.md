# ReelHive

ReelHive is a short-video sharing web app, built for **COM769 Scalable Advanced Software Solutions, Coursework 2** (Ulster University, 2026/27).

Users can upload short videos, scroll through a vertical feed, like videos, comment on them and delete them. This first version runs on **localhost**. The code is structured so the local storage and database can be swapped for Azure services in the next stage.

## Features (current version)

- **Vertical, snap-scrolling feed.** One video per screen; it autoplays muted when on screen and pauses when you scroll away
- **Player controls:** play/pause, seek bar, elapsed/total time, playback speed (0.5x to 2x), mute/unmute
- **Navigation:** scroll, swipe, the up/down buttons, or the keyboard (up/down arrows, `Space` to pause, `M` to mute)
- **Likes:** like/unlike with the heart button, or double-click the video
- **Comments panel** that slides in from the side
- **Save** videos to a personal "Saved" collection (kept in the browser)
- **Share:** copy a link that opens the app on that exact video (`/?v=<id>`)
- **Search** by title, caption, creator or `#tag`; hashtags in captions can be clicked
- **"For you"** (newest) and **"Popular"** (most liked) feeds, with view counts and a "New" badge
- **Upload** with live preview, caption counter and progress bar (MP4, WebM, MOV)
- **Delete** a video (removes both the record and the file)
- **Responsive layout:** sidebar on desktop, full-screen with bottom navigation on phones
- REST API with input validation (file type, size, required title)
- Automated tests and a CI workflow on GitHub Actions
- Dockerfile and docker-compose for container deployment

## Run it locally

You need **Node.js 20 or newer** (`node -v` to check).

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

`npm run dev` also works. It restarts the server automatically whenever a file in `src/` changes (refresh the browser to see the change).

**To stop the app:** press **Ctrl + C** in the terminal where it is running.

**To restart it:** stop it with **Ctrl + C**, then run `npm start` again.

### Run the tests

```bash
npm test
```

### Run with Docker

```bash
docker compose up --build
```

Then open http://localhost:3000. Uploaded videos are kept on the `reelhive-data` Docker volume.

**To stop the containers:** press **Ctrl + C**, then run:

```bash
docker compose down
```

`docker compose down` keeps the uploaded videos. `docker compose down -v` also deletes the volume and all uploaded videos.

**To restart:** run `docker compose up --build` again (`--build` picks up any code changes).

**Run in the background instead:** `docker compose up --build -d` starts the containers and gives the terminal back. Stop them later with `docker compose down`. Use `docker compose logs -f` to watch the logs.

**Using a different port:** if port 3000 is already in use, change the left-hand number in `docker-compose.yml`, e.g. `"3001:3000"`, then open http://localhost:3001. The right-hand number is the port inside the container and stays 3000.

> Only run one version at a time on the same port. Stop `npm start` before starting Docker on port 3000, or use a different port as above.

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
| GET | `/api/videos?sort=new\|popular&q=text` | List videos (optional search by text or #tag) |
| GET | `/api/videos/:id` | Get one video |
| POST | `/api/videos` | Upload (multipart: `video`, `title`, `description`, `creator`) |
| POST | `/api/videos/:id/like` | Like a video |
| POST | `/api/videos/:id/unlike` | Remove a like |
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
