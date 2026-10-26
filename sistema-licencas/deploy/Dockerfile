FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
ENV DATA_DIR=/data PORT=3000 NODE_ENV=production
VOLUME /data
EXPOSE 3000
CMD ["node", "src/index.js"]
