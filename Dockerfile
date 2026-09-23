FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
COPY dashboard/package.json dashboard/bun.lock ./dashboard/
RUN bun install --frozen-lockfile && cd dashboard && bun install --frozen-lockfile

COPY . .
RUN cd dashboard && bun run build

ENV CI=true WRANGLER_SEND_METRICS=false MAHORAGA_DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 3000

CMD ["bun", "server/start.ts"]
