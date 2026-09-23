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
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD bun -e "const r = await fetch('http://127.0.0.1:3000/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "server/start.ts"]
