#!/bin/sh
set -e

echo "[entrypoint] running database migrations…"
npx prisma migrate deploy --schema prisma/schema.prisma

if [ "${SEED_ON_BOOT:-true}" = "true" ]; then
  echo "[entrypoint] bootstrapping seed data…"
  npm run db:seed || true
fi

echo "[entrypoint] starting API…"
exec node dist/index.js
