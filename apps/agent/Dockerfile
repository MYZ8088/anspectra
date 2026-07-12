# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
WORKDIR /app
ARG PNPM_VERSION=10.16.0
RUN npm install -g pnpm@${PNPM_VERSION}

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.json ./
COPY apps/agent ./apps/agent
COPY packages/db ./packages/db
COPY packages/errors ./packages/errors
COPY packages/services ./packages/services
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils

RUN --mount=type=cache,id=pnpm-store-agent,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS builder
RUN pnpm turbo build --filter=@aloom/agent...
RUN pnpm deploy --filter @aloom/agent --prod /app/out

FROM node:20-bookworm-slim AS runner
ARG PNPM_VERSION=10.16.0
ARG CAMOUFOX_PIP_SPEC
ARG CAMOUFOX_BROWSER_CHANNEL
ENV CAMOUFOX_VENV=/opt/aloom/camoufox-venv

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
  set -eux; \
  rm -f /etc/apt/apt.conf.d/docker-clean; \
  apt-get -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 update; \
  attempt=1; \
  until apt-get -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 install -y --no-install-recommends \
  python3 \
  python3-venv \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 libdbus-glib-1-2 \
  libx11-xcb1 libxt6 \
  ca-certificates \
  fontconfig \
  xvfb \
  fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji; do \
    if [ "${attempt}" -ge 5 ]; then exit 1; fi; \
    attempt=$((attempt + 1)); \
    sleep $((attempt * 3)); \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 update; \
  done; \
  fc-cache -f; \
  test -n "${CAMOUFOX_PIP_SPEC}"; \
  test -n "${CAMOUFOX_BROWSER_CHANNEL}"; \
  python3 -m venv "${CAMOUFOX_VENV}"; \
  "${CAMOUFOX_VENV}/bin/python" -m pip install --no-cache-dir --upgrade pip setuptools wheel; \
  "${CAMOUFOX_VENV}/bin/python" -m pip install --no-cache-dir "${CAMOUFOX_PIP_SPEC}"; \
  "${CAMOUFOX_VENV}/bin/python" -m camoufox set "${CAMOUFOX_BROWSER_CHANNEL}"; \
  "${CAMOUFOX_VENV}/bin/python" -m camoufox fetch

WORKDIR /app
ENV NODE_ENV=production
ENV CAMOUFOX_PYTHON_BIN=/opt/aloom/camoufox-venv/bin/python
ENV PATH=/opt/aloom/camoufox-venv/bin:${PATH}

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY --from=builder /app/out ./
COPY apps/agent/docker/start-worker.sh /usr/local/bin/start-worker
RUN chmod +x /usr/local/bin/start-worker

RUN chown -R node:node /app

CMD ["/usr/local/bin/start-worker"]
