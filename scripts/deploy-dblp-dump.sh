#!/usr/bin/env bash
# Deploys a new DBLP XML dump to a rankme server and triggers a local
# reimport (decompress -> reindex -> rebuild the venue name index), the
# same manual flow used throughout local development (see api/src/admin.js
# -- extractVenues/processXML/applyIncrementalUpdate/venueLookup).
#
# WHY THIS EXISTS: dblp.org is behind Anubis anti-bot protection, so the
# app cannot fetch the dump itself on a server (see throttler.js's
# dblp_scrape_limiter comment) -- a real browser has to fetch dblp.xml.gz
# and dblp.xml.gz.md5 by hand from https://dblp.org/xml/ and hand them to
# this script.
#
# WHAT IT DOES:
#   1. Copies the .gz and .md5 files to the remote host, then docker cp's
#      them into the running api container's /data volume (a named Docker
#      volume, not bind-mounted -- docker cp is the only way in).
#   2. Bumps mongo's resources for the import (see MONGO RESOURCE BUMP).
#   3. Triggers the import via POST /api/admin/venues (needs ADMIN_TOKEN).
#   4. Polls GET /api/dblp/status until the import finishes (ready or
#      failed) or the timeout below is hit, printing progress the whole
#      time.
#   5. Shrinks mongo back down, always (trap below), whether the import
#      succeeded, failed, or this script was interrupted.
#
# WHAT IT DELIBERATELY DOES NOT DO: touch docker-compose for anything other
# than mongo's own resource bump, or change anything else about how the app
# runs. The api process itself already exposes /api/dblp/status
# (ready/importing/version) so the front end disables the DBLP tab with a
# clear message for the whole import -- no coordination needed here beyond
# triggering it and waiting.
#
# MONGO RESOURCE BUMP: the local DBLP dump this imports is ~8GB of data+
# indexes once loaded (see api/src/dblpLocal.js) -- far more than mongo's
# steady-state 0.25GB cache / 768M container limit (docker-compose.prod.yml)
# is sized for, and this host only has ~3.7GB RAM total, so that bump can't
# just be made permanent the way it is in dev (docker-compose.dev.yml's own,
# much bigger one). Instead this script brings mongo up with a temporarily
# larger MONGO_CACHE_GB/MONGO_MEMORY_LIMIT (a restart either way -- that
# flag can't change on a live mongod), runs the import, then always brings
# it back down to docker-compose.prod.yml's own defaults on exit (trap
# below), success or failure, so the bump never lingers as a standing
# reservation on a box this tight on RAM. Imports after the very first one
# only touch a handful of records (see applyIncrementalUpdate in admin.js),
# so this daily restart-bump-restart dance costs a couple of short mongo
# blips, not a heavy resize for what's usually a light update.
#
# SAFETY / CAPACITY NOTE: this decompresses to a ~5.3GB XML file and reads
# it in full on every run -- CPU heavy for a few minutes regardless of how
# much actually changed. The very first import on a given server
# additionally rebuilds every collection from scratch (drop + full
# reinsert, ~10-15 minutes on the hardware this was developed against);
# every later one only writes the records dblp's own mdate marks as
# changed since last time. The rest of the site (HAL, author/team pages,
# everything not DBLP) is unaffected while this runs; only the DBLP tab
# goes into its "importing" state.
#
# USAGE:
#   ./scripts/deploy-dblp-dump.sh <path/to/dblp.xml.gz> <path/to/dblp.xml.gz.md5> <ssh-host> [remote-app-dir] [api-container-name]
#
# EXAMPLE:
#   ./scripts/deploy-dblp-dump.sh ~/Downloads/dblp.xml.gz ~/Downloads/dblp.xml.gz.md5 vps
#
# The admin token is read from ADMIN_TOKEN in the remote <remote-app-dir>/.env
# (the same file docker-compose.prod.yml already requires) -- not passed on
# the command line, so it never ends up in shell history here or there.

set -euo pipefail

GZ_PATH="${1:?Usage: $0 <dblp.xml.gz> <dblp.xml.gz.md5> <ssh-host> [remote-app-dir] [api-container-name]}"
MD5_PATH="${2:?Missing dblp.xml.gz.md5 path}"
SSH_HOST="${3:?Missing ssh host (e.g. vps)}"
REMOTE_DIR="${4:-~/rankme}"
API_CONTAINER="${5:-rankme-api-1}"
MONGO_CONTAINER="rankme-mongo-1"  # same project-name-based convention as API_CONTAINER's default

POLL_INTERVAL_S=15
POLL_TIMEOUT_S=1800  # 30 minutes -- generous margin over the observed ~10-15 min

# Import-time-only mongo sizing (see MONGO RESOURCE BUMP above). Chosen to
# leave real headroom for a full drop+reinsert without pushing this box's
# total container memory limits (api 1G + redis 768M + front 256M +
# reverseproxy 256M + this) meaningfully past its ~3.7GB of physical RAM.
MONGO_IMPORT_CACHE_GB=1
MONGO_IMPORT_MEMORY_LIMIT=1536M

for f in "$GZ_PATH" "$MD5_PATH"; do
  [ -f "$f" ] || { echo "Not a file: $f" >&2; exit 1; }
done

echo "==> Checking remote disk/memory headroom on $SSH_HOST (informational -- not a hard gate)"
ssh "$SSH_HOST" 'echo "--- memory ---"; free -h; echo "--- disk (docker root) ---"; df -h /var/lib/docker 2>/dev/null || df -h /'

echo "==> Reading ADMIN_TOKEN from $REMOTE_DIR/.env on $SSH_HOST"
ADMIN_TOKEN="$(ssh "$SSH_HOST" "grep -m1 '^ADMIN_TOKEN=' '$REMOTE_DIR/.env' | cut -d= -f2-")"
if [ -z "$ADMIN_TOKEN" ]; then
  echo "Could not read ADMIN_TOKEN from $REMOTE_DIR/.env on $SSH_HOST" >&2
  exit 1
fi

REMOTE_TMP="/tmp/dblp-dump-deploy-$$"
echo "==> Copying dump files to $SSH_HOST:$REMOTE_TMP"
ssh "$SSH_HOST" "mkdir -p '$REMOTE_TMP'"
scp "$GZ_PATH" "$SSH_HOST:$REMOTE_TMP/dblp.xml.gz"
scp "$MD5_PATH" "$SSH_HOST:$REMOTE_TMP/dblp.xml.gz.md5"

echo "==> docker cp'ing into $API_CONTAINER:/data/dblp/ (the app's own MD5 check --"
echo "    see admin.js's verifyMD5 -- catches a corrupted transfer, so no separate"
echo "    checksum step here)"
ssh "$SSH_HOST" "sudo docker exec '$API_CONTAINER' mkdir -p /data/dblp && \
  sudo docker cp '$REMOTE_TMP/dblp.xml.gz' '$API_CONTAINER':/data/dblp/dblp.xml.gz && \
  sudo docker cp '$REMOTE_TMP/dblp.xml.gz.md5' '$API_CONTAINER':/data/dblp/dblp.xml.gz.md5 && \
  rm -rf '$REMOTE_TMP'"

echo "==> Bumping mongo to ${MONGO_IMPORT_CACHE_GB}GB cache / ${MONGO_IMPORT_MEMORY_LIMIT} limit for the import"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && sudo env MONGO_CACHE_GB=$MONGO_IMPORT_CACHE_GB MONGO_MEMORY_LIMIT=$MONGO_IMPORT_MEMORY_LIMIT docker compose -f docker-compose.prod.yml up -d mongo"

shrink_mongo_back() {
  echo "==> Shrinking mongo back to docker-compose.prod.yml's own defaults"
  ssh "$SSH_HOST" "cd '$REMOTE_DIR' && sudo docker compose -f docker-compose.prod.yml up -d mongo" \
    || echo "WARNING: failed to shrink mongo back down -- check it manually on $SSH_HOST" >&2
}
# Runs on every exit path (success, timeout, or an earlier command failing
# under set -e) so the bump never lingers as a standing reservation.
trap shrink_mongo_back EXIT

echo "==> Waiting for mongo to report healthy after the restart"
health=""
for _ in $(seq 1 20); do
  health="$(ssh "$SSH_HOST" "sudo docker inspect --format '{{.State.Health.Status}}' $MONGO_CONTAINER" 2>/dev/null || true)"
  [ "$health" = "healthy" ] && break
  sleep 3
done
if [ "$health" != "healthy" ]; then
  echo "mongo did not report healthy in time (last status: ${health:-unknown})" >&2
  exit 1
fi

echo "==> Triggering the import (POST /api/admin/venues)"
ssh "$SSH_HOST" "curl -s 'http://localhost/api/admin/venues' -H 'X-Admin-Token: $ADMIN_TOKEN'"
echo

echo "==> Polling /api/dblp/status (every ${POLL_INTERVAL_S}s, up to ${POLL_TIMEOUT_S}s)"
elapsed=0
while [ "$elapsed" -lt "$POLL_TIMEOUT_S" ]; do
  body="$(ssh "$SSH_HOST" "curl -s http://localhost/api/dblp/status")"
  echo "  [$(date +%H:%M:%S)] $body"
  case "$body" in
    *'"ready":true'*)
      echo "==> Import finished successfully."
      exit 0
      ;;
  esac
  sleep "$POLL_INTERVAL_S"
  elapsed=$((elapsed + POLL_INTERVAL_S))
done

echo "==> Timed out after ${POLL_TIMEOUT_S}s waiting for readiness." >&2
echo "    Check the api container's own logs for the actual error:" >&2
echo "    ssh $SSH_HOST 'sudo docker logs --tail 100 $API_CONTAINER'" >&2
exit 1
