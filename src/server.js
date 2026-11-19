// Entry point: wires the local adapters into the app and starts listening.
const config = require('./config');
const { createApp } = require('./app');
const { createLocalStorage } = require('./storage/localStorage');
const { createJsonRepository } = require('./data/jsonRepository');

async function main() {
  const storage = createLocalStorage(config.uploadDir);
  const repo = createJsonRepository(config.dataFile);
  await storage.init();
  await repo.init();

  const app = createApp({ repo, storage, maxUploadMb: config.maxUploadMb });
  app.listen(config.port, () => {
    console.log(`ReelHive running at http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start ReelHive:', err);
  process.exit(1);
});
