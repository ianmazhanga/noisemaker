# The video worker as a container, for hosts that run long jobs (Fly.io, Render, Railway,
# a VPS…) instead of GitHub Actions. Build from the repository root:
#   docker build -f worker/Dockerfile -t noisemakers-worker .
#   docker run --env-file worker.env noisemakers-worker
# worker.env holds SUPABASE_URL, SUPABASE_SECRET_KEY and OPENAI_API_KEY. The container works
# through queued jobs and exits; run it on a schedule, or with WORKER_LOOP=1 to keep checking.
FROM node:24-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg fonts-inter fonts-dejavu-core fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The worker uses only Node's built-in modules, so there is nothing to install.
COPY api ./api
COPY scripts/lib ./scripts/lib
COPY src/lib ./src/lib
COPY src/types ./src/types
COPY src/assets/brand ./src/assets/brand
COPY worker ./worker
USER node
CMD ["sh", "-c", "while true; do node --experimental-strip-types --no-warnings worker/index.ts; [ \"$WORKER_LOOP\" = 1 ] || exit 0; sleep 60; done"]
