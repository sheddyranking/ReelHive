# Container image for ReelHive (Week 7: Docker).
FROM node:22-alpine

WORKDIR /app

# Install only production dependencies first so this layer is cached
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    DATA_FILE=/data/videos.json

# Uploaded videos and metadata live on a volume, outside the container
VOLUME ["/data"]
EXPOSE 3000

# Run as the unprivileged "node" user rather than root
RUN mkdir -p /data && chown node:node /data
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/server.js"]
