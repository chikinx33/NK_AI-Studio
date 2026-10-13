# nk-director — Cloud Run (asia-northeast3)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
# 자동 검수(/v1/qa): 스킬의 qa_video.py 를 그대로 돌린다(ffmpeg·numpy·scipy).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-numpy python3-scipy \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY skills/nk-cf-director/scripts/qa_video.py ./qa/qa_video.py
USER node
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
