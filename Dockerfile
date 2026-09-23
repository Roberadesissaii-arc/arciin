# Arciin production images: api, worker, web.
#
# One file with three targets, and that is the point. As three separate
# Dockerfiles the images shared 328MB and carried ~3.55GB of unique layers each
# — roughly 11GB to hold a release, which did not fit on the host this release
# was certified on. They were not shipping different things; they were shipping
# the *same* things down three chains Docker had no way to recognise as equal.
#
# Two structural costs dominated, and both are gone here:
#
#   1. Every image ran `pnpm install --prod` against the root manifest, which
#      declares the whole monorepo's dependencies. That is a 1.05GB layer, and
#      because each Dockerfile preceded it with a slightly different set of
#      COPY lines, its hash differed every time. Identical content, three
#      copies. The `prod-deps` stage below builds it once and all three targets
#      inherit it.
#
#   2. Each image finished with `chown -R 1000:1000 /app`, which rewrites
#      metadata on every file in node_modules and so copies all of it up into a
#      new layer: another 1.01GB per image, a byte-for-byte duplicate of the
#      install directly beneath it. Nothing here runs as root after the base
#      stage, so the files are created owned by uid 1000 and there is nothing
#      to chown afterwards.
#
# ffmpeg and poppler are installed in a stage the api and worker share rather
# than separately in each; the web image, which spawns neither, never inherits
# them at all.
#
# Node 24, and Debian slim rather than Alpine — both load-bearing:
#   - undici 8 calls webidl.util.markAsUncloneable, absent before Node 22, so
#     on node:20 the API built, migrated, then died on its first import.
#   - pdfjs-dist pulls @napi-rs/canvas, whose musl build dies with SIGILL the
#     moment pdfjs is imported. A native crash no try/catch can see: it took the
#     worker down with it and left PDF uploads stuck on PROCESSING.

# ─────────────────────────────────────────────────────────────────────────────
# base — Node + pnpm. Shared by all three images.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim AS base
# pnpm is installed into the image rather than left to corepack's shim. Enabling
# corepack alone means the first pnpm invocation downloads the pinned version:
# that turned every container start into a call to the npm registry, which a
# production host is entitled to block. On this one it printed "Corepack is
# about to download pnpm" and the worker restarted twice, abandoning a job
# mid-flight. Installed globally it is on PATH for every user, with no cache
# keyed to the account that ran the build.
RUN npm install -g pnpm@10.32.1 && npm cache clean --force
# node:*-slim already ships a "node" user at uid 1000. /app belongs to it from
# the start so that no later stage has to rewrite ownership across node_modules.
RUN mkdir -p /app && chown 1000:1000 /app
WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# manifests — everything the resolver reads, and nothing else.
#
# The COPY set is identical in all three images on purpose: the layer hash is
# what makes the install below shareable, and it changes if this list does.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS manifests
USER 1000:1000
COPY --chown=1000:1000 package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=1000:1000 apps/web/package.json apps/web/package.json
COPY --chown=1000:1000 apps/api/package.json apps/api/package.json
COPY --chown=1000:1000 apps/worker/package.json apps/worker/package.json
COPY --chown=1000:1000 packages/database/package.json packages/database/package.json
COPY --chown=1000:1000 packages/shared/package.json packages/shared/package.json
COPY --chown=1000:1000 packages/config/package.json packages/config/package.json
COPY --chown=1000:1000 packages/types/package.json packages/types/package.json
COPY --chown=1000:1000 packages/storage/package.json packages/storage/package.json
COPY --chown=1000:1000 packages/ui/package.json packages/ui/package.json
COPY --chown=1000:1000 packages/media-ai/package.json packages/media-ai/package.json
# The Prisma client is generated from this, so it belongs to the shared stage.
COPY --chown=1000:1000 prisma ./prisma

# ─────────────────────────────────────────────────────────────────────────────
# prod-deps — production dependencies + generated Prisma client.
#
# The single most expensive layer in the release, built once for all three.
# --prod drops eslint, typescript, vitest, tailwind, @types/* and the Playwright
# client. prisma stays for migrate/seed in the entrypoint. API and worker run
# compiled bundles from apps/*/dist (see scripts/build-backend.mjs).
# ─────────────────────────────────────────────────────────────────────────────
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
RUN pnpm db:generate

# ─────────────────────────────────────────────────────────────────────────────
# web-builder — the only stage that needs the dev toolchain.
#
# Kept off the runtime chain entirely, so tailwind, typescript and the rest are
# build input that never reaches an image.
# ─────────────────────────────────────────────────────────────────────────────
FROM manifests AS build-deps
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM build-deps AS web-builder
COPY --chown=1000:1000 . .

ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_SOCKET_URL=
ARG NEXT_PUBLIC_ARCIIN_API_ORIGIN=
ARG ARCIIN_PUBLIC_URL=http://localhost

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_SOCKET_URL=${NEXT_PUBLIC_SOCKET_URL}
ENV NEXT_PUBLIC_ARCIIN_API_ORIGIN=${NEXT_PUBLIC_ARCIIN_API_ORIGIN}
ENV ARCIIN_PUBLIC_URL=${ARCIIN_PUBLIC_URL}

# The wasm copy is explicit because the install above runs --ignore-scripts.
# Without it PDF preview renders a grey placeholder, so it is not optional.
RUN pnpm pdfjs:copy-wasm && pnpm db:generate && pnpm build:web && pnpm build:backend

# ─────────────────────────────────────────────────────────────────────────────
# media — ffmpeg + poppler. Shared by api and worker; never reaches web.
#
# The API spawns ffprobe for classification and ffmpeg/pdftoppm for on-demand
# thumbnails; the worker spawns them for the upload pipeline. The web image
# spawns neither, so it does not inherit this stage.
# ─────────────────────────────────────────────────────────────────────────────
FROM prod-deps AS media
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg poppler-utils util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000

# ─────────────────────────────────────────────────────────────────────────────
# api
# ─────────────────────────────────────────────────────────────────────────────
FROM media AS api
USER root
# bash for the entrypoint, matching pg_dump/psql for Postgres 16, curl for health.
# Debian's default postgresql-client is 15 and refuses to dump a 16 server, which
# would block every first-boot migrate (ARC-014).
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl ca-certificates gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/install-cloudflared.sh /tmp/install-cloudflared.sh
RUN chmod +x /tmp/install-cloudflared.sh && /tmp/install-cloudflared.sh && rm /tmp/install-cloudflared.sh
USER 1000:1000

# Compiled bundles come from the builder, not the host tree (dist is gitignored).
COPY --from=web-builder --chown=1000:1000 /app/apps/api/dist ./apps/api/dist
COPY --chown=1000:1000 packages ./packages
COPY --chown=1000:1000 scripts ./scripts
COPY --chown=1000:1000 tsconfig.base.json tsconfig.json ./
RUN chmod +x scripts/arciin-init.sh scripts/entrypoint-api.sh scripts/restore-migration-backup.sh scripts/migration-backup.sh

ENV NODE_ENV=production
ENV API_PORT=4000
EXPOSE 4000

# bash, not sh. The entrypoint sets `-o pipefail`, which Alpine's busybox ash
# accepts and Debian's dash does not — under `sh` the container died on line 2
# of its own entrypoint, restarting forever.
CMD ["bash", "scripts/entrypoint-api.sh"]

# ─────────────────────────────────────────────────────────────────────────────
# worker
# ─────────────────────────────────────────────────────────────────────────────
FROM media AS worker
USER root
# yt-dlp and gallery-dl back URL imports, which only the worker performs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      yt-dlp gallery-dl \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000

COPY --from=web-builder --chown=1000:1000 /app/apps/worker/dist ./apps/worker/dist
COPY --chown=1000:1000 packages ./packages
COPY --chown=1000:1000 scripts ./scripts
COPY --chown=1000:1000 tsconfig.base.json tsconfig.json ./
RUN chmod +x scripts/worker-healthcheck.mjs

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/index.js"]

# ─────────────────────────────────────────────────────────────────────────────
# web — build output only. No media toolchain, no application source.
# ─────────────────────────────────────────────────────────────────────────────
FROM prod-deps AS web

# Workspace packages are transpiled by Next at build time, but next.config.ts
# and the proxy still resolve them at boot.
COPY --chown=1000:1000 packages ./packages
COPY --chown=1000:1000 apps/web/next.config.ts apps/web/proxy.ts ./apps/web/
# next-env.d.ts is gitignored — Next generates it, so take it from the builder.
COPY --from=web-builder --chown=1000:1000 /app/apps/web/next-env.d.ts ./apps/web/next-env.d.ts
COPY --chown=1000:1000 tsconfig.base.json tsconfig.json ./

# Build output and static assets (public/ carries the copied pdfjs wasm).
#
# The builder writes .next-build, because build:web pins NEXT_DIST_DIR so that
# a bare build on a live host can never overwrite the directory the running
# server is serving from. Inside an image there is no running server to
# protect, and the runtime below starts with the default distDir, so the
# staging directory is copied to the name `next start` expects. Renaming it
# here keeps the safety on the host without making the image carry it.
COPY --from=web-builder --chown=1000:1000 /app/apps/web/.next-build ./apps/web/.next
COPY --from=web-builder --chown=1000:1000 /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "start:web"]
