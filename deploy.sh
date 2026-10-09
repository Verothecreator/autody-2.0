#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Installed as /usr/local/sbin/autody-sync on the VPS.
APP_DIR=/var/www/autody-2.0
RELEASES=/var/www/autody-releases
STATE=/var/lib/autody
SHARED=$STATE/shared
SOURCE=$STATE/source.git
APP_NAME=autody
REPO_URL=https://github.com/Verothecreator/autody-2.0.git

mkdir -p "$STATE" "$RELEASES"
exec 9>"$STATE/deployment.lock"
flock -n 9 || exit 0
test -s "$SHARED/.env"
test -d "$SHARED/data"

if [ ! -d "$SOURCE" ]; then
  git clone --bare "$REPO_URL" "$SOURCE"
fi
git --git-dir="$SOURCE" fetch --quiet origin main:refs/heads/main
COMMIT=$(git --git-dir="$SOURCE" rev-parse refs/heads/main)
if [ -f "$STATE/current-commit" ] && [ "$(cat "$STATE/current-commit")" = "$COMMIT" ] && [ "${1:-}" != --force ]; then
  exit 0
fi

RELEASE="$RELEASES/$COMMIT"
PREVIOUS=$(readlink -f "$APP_DIR")
SWITCHED=false
BACKUP="$STATE/backups/$COMMIT-$(date -u +%Y%m%dT%H%M%SZ)"

healthy() {
  curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/api/db/status |
    node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{try{const s=JSON.parse(b);process.exit(s.success&&s.configured&&s.provider==="supabase-postgres"?0:1)}catch{process.exit(1)}})'
}

point_to() {
  ln -sfn "$1" "$APP_DIR.next"
  mv -Tf "$APP_DIR.next" "$APP_DIR"
}

rollback() {
  local code=$?
  trap - ERR
  if [ "$SWITCHED" = true ]; then
    echo "Deployment failed; returning to $PREVIOUS" >&2
    point_to "$PREVIOUS"
    pm2 restart "$APP_NAME" --update-env || true
    pm2 save || true
  fi
  printf '{"commit":"%s","failedAt":"%s","exitCode":%s}\n' "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code" > "$STATE/last-failure.json"
  exit "$code"
}
trap rollback ERR

echo "Preparing release $COMMIT"
mkdir -p "$RELEASE"
if [ ! -f "$RELEASE/.prepared" ]; then
  # An interrupted install must never extract sample data through a shared link.
  if [ ! -f "$RELEASE/.extracted" ]; then
    git --git-dir="$SOURCE" archive "$COMMIT" | tar -x -C "$RELEASE"
    if [ -d "$RELEASE/data" ] && [ ! -L "$RELEASE/data" ]; then
      mv "$RELEASE/data" "$RELEASE/data-seed"
    fi
    touch "$RELEASE/.extracted"
  fi
  ln -sfn "$SHARED/data" "$RELEASE/data"
  ln -sfn "$SHARED/.env" "$RELEASE/.env"
  ln -sfn "$SHARED/orders.json" "$RELEASE/orders.json"
  cd "$RELEASE"
  npm install --omit=dev --no-package-lock --no-audit --no-fund
  node --check server.js
  touch .prepared
fi

mkdir -p "$BACKUP"
cp -a "$SHARED/.env" "$BACKUP/.env"
cp -a "$SHARED/data" "$BACKUP/data"
cp -a "$SHARED/orders.json" "$BACKUP/orders.json"
printf '%s\n' "$PREVIOUS" > "$BACKUP/previous-release"

if [ ! -L "$APP_DIR" ]; then
  LEGACY="$RELEASES/legacy-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$APP_DIR" "$LEGACY"
  PREVIOUS=$LEGACY
  SWITCHED=true
fi
point_to "$RELEASE"
SWITCHED=true
pm2 restart "$APP_NAME" --update-env

READY=false
for attempt in $(seq 1 12); do
  if healthy; then READY=true; break; fi
  sleep 2
done
test "$READY" = true
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/api/live/status > "$STATE/last-live-status.json"
pm2 save

# Use the script shipped with the successful release for the next deployment.
install -m 700 "$RELEASE/deploy.sh" /usr/local/sbin/autody-sync.next
mv /usr/local/sbin/autody-sync.next /usr/local/sbin/autody-sync

printf '{"commit":"%s","deployedAt":"%s","database":"supabase-postgres"}\n' "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE/deployment-status.json.next"
chmod 644 "$STATE/deployment-status.json.next"
mv "$STATE/deployment-status.json.next" "$STATE/deployment-status.json"
printf '%s\n' "$COMMIT" > "$STATE/current-commit.next"
mv "$STATE/current-commit.next" "$STATE/current-commit"
trap - ERR

# Keep ten recent releases and snapshots; shared production data is never pruned.
mapfile -t OLD_RELEASES < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +11 | cut -d' ' -f2-)
for old in "${OLD_RELEASES[@]}"; do
  [ "$old" = "$RELEASE" ] && continue
  [ "$old" = "$PREVIOUS" ] && continue
  case "$old" in "$RELEASES"/*) rm -rf -- "$old" ;; *) exit 1 ;; esac
done
mapfile -t OLD_BACKUPS < <(find "$STATE/backups" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +11 | cut -d' ' -f2-)
for old in "${OLD_BACKUPS[@]}"; do
  case "$old" in "$STATE/backups"/*) rm -rf -- "$old" ;; *) exit 1 ;; esac
done
echo "Deployed $COMMIT successfully at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
