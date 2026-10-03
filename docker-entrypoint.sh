#!/bin/sh
set -e

echo "Waiting for database..."
node <<'EOF'
const net = require("net");

const url = process.env.DATABASE_URL || "";
const hostMatch = url.match(/@([^:/?]+)/);
const portMatch = url.match(/:(\d+)(?:\/|\?|$)/);
const host = hostMatch ? hostMatch[1] : "db";
const port = portMatch ? Number(portMatch[1]) : 5432;

function tryConnect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve();
    });
    socket.on("error", reject);
  });
}

(async () => {
  for (;;) {
    try {
      await tryConnect();
      process.exit(0);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
})();
EOF

echo "Applying schema..."
npx prisma db push --skip-generate

echo "Starting Skylagring..."
exec node server.js
