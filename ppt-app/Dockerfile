# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate && npm run build

FROM builder AS migrate
ENV NODE_ENV=production
CMD ["sh", "-c", "npm run db:deploy && npm run db:seed && storage_path=\"${PPT_STORAGE_PATH:-${LOCAL_STORAGE_PATH:-/app/storage}}\" && mkdir -p \"$storage_path\" && chown -R node:node \"$storage_path\""]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=37623
RUN mkdir -p /app/storage && chown -R node:node /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 37623
CMD ["node", "server.js"]
