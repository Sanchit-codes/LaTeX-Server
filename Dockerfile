# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine

# Install Docker CLI (so the API server can shell out to Docker)
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy deps and source
COPY --from=build /app/node_modules ./node_modules
COPY . .

# NOTE: We run as root so the container can access /var/run/docker.sock
# (the Docker socket is owned by root:docker on the host, and the socket is
# bind-mounted into the container).
# For a hardened setup: find your server's docker group GID with
#   stat -c '%g' /var/run/docker.sock
# then add  group_add: ["<GID>"]  in docker-compose.yml and switch to a
# non-root user here.

EXPOSE 9180

ENV NODE_ENV=production

CMD ["node", "server.js"]
