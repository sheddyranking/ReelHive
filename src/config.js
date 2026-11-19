// Central configuration. Values come from environment variables so the same
// code can run on localhost, in Docker, or on Azure App Service unchanged.
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // Where uploaded video files are kept (local stand-in for Azure Blob Storage).
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  // Where video metadata is kept (local stand-in for Azure Cosmos DB).
  dataFile: process.env.DATA_FILE || path.join(root, 'data', 'videos.json'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 100,
};
