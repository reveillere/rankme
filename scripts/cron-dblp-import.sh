#!/usr/bin/env bash
# Bumps mongo/api memory, triggers a DBLP reimport, and shrinks both back
# down. Meant to run ON THE SERVER ITSELF via cron (no ssh/scp, unlike
# scripts/deploy-dblp-dump.sh's one-off manually-provided-dump flow) --
# api/src/admin.js's extractVenues now fetches the current month's dump
# directly from Dagstuhl's DROPS mirror on its own (see that file's
# dagstuhlDumpUrls; dblp.org itself is still blocked by Anubis anti-bot
# protection for a server-side fetch), so this script only has to trigger
# it and wait, the same way deploy-dblp-dump.sh's own tail half does.
#
# INSTALL (as root, so the `sudo docker` calls below never hit an
# interactive password prompt under cron):
#   sudo crontab -e
#   0 2 2 * * /home/ubuntu/rankme/scripts/cron-dblp-import.sh >> /var/log/rankme-dblp-cron.log 2>&1
# Day 2 at 02:00: a day's margin after Dagstuhl's own 1st-of-the-month
# publish (so the current month's file is reliably already there), and
# off-peak for the site's live traffic during the import.
#
# USAGE:
#   ./scripts/cron-dblp-import.sh [remote-app-dir] [api-container-name]

set -euo pipefail

REMOTE_DIR="${1:-$HOME/rankme}"
API_CONTAINER="${2:-rankme-api-1}"
MONGO_CONTAINER="rankme-mongo-1"  # same project-name-based convention as API_CONTAINER's default

POLL_INTERVAL_S=15
POLL_TIMEOUT_S=1800  # 30 minutes -- generous margin over the observed ~10-15 min

# See scripts/deploy-dblp-dump.sh's RESOURCE BUMP comment for why these
# bumps exist and how these specific values were chosen.
MONGO_IMPORT_CACHE_GB=1
MONGO_IMPORT_MEMORY_LIMIT=1536M
API_IMPORT_MEMORY_LIMIT=2G

log() { echo "[$(date -Is)] $*"; }

log "==> Bumping mongo to ${MONGO_IMPORT_CACHE_GB}GB cache / ${MONGO_IMPORT_MEMORY_LIMIT} limit, and api to ${API_IMPORT_MEMORY_LIMIT}, for the import"
(cd "$REMOTE_DIR" && sudo env MONGO_CACHE_GB=$MONGO_IMPORT_CACHE_GB MONGO_MEMORY_LIMIT=$MONGO_IMPORT_MEMORY_LIMIT API_MEMORY_LIMIT=$API_IMPORT_MEMORY_LIMIT docker compose -f docker-compose.prod.yml up -d mongo api)

shrink_back() {
  log "==> Shrinking mongo and api back to docker-compose.prod.yml's own defaults"
  (cd "$REMOTE_DIR" && sudo docker compose -f docker-compose.prod.yml up -d mongo api) \
    || echo "WARNING: failed to shrink mongo/api back down -- check them manually" >&2
}
# Runs on every exit path (success, timeout, or an earlier command failing
# under set -e) so the bump never lingers as a standing reservation.
trap shrink_back EXIT

log "==> Waiting for mongo and api to report healthy after the restart"
for container in "$MONGO_CONTAINER" "$API_CONTAINER"; do
  health=""
  for _ in $(seq 1 20); do
    health="$(sudo docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
    [ "$health" = "healthy" ] && break
    sleep 3
  done
  if [ "$health" != "healthy" ]; then
    echo "$container did not report healthy in time (last status: ${health:-unknown})" >&2
    exit 1
  fi
done

ADMIN_TOKEN="$(grep -m1 '^ADMIN_TOKEN=' "$REMOTE_DIR/.env" | cut -d= -f2-)"
if [ -z "$ADMIN_TOKEN" ]; then
  echo "Could not read ADMIN_TOKEN from $REMOTE_DIR/.env" >&2
  exit 1
fi

# https + -k, not plain http: nginx.conf.prod redirects any non-https
# request to https (301, see its `if ($scheme != "https")` block) -- a
# plain http:// call here got back that redirect page, not the actual API
# response, silently (curl treats a 301 as success). -k skips cert
# verification because the cert is issued for rankme.fr, not the
# `localhost` name curl sends as Host/SNI here -- fine since this is
# loopback traffic on the box itself, not going out over the network.
log "==> Triggering the import (POST /api/admin/venues -- extractVenues fetches this month's Dagstuhl dump itself)"
curl -sk 'https://localhost/api/admin/venues' -H "X-Admin-Token: $ADMIN_TOKEN"
echo

log "==> Polling /api/dblp/status (every ${POLL_INTERVAL_S}s, up to ${POLL_TIMEOUT_S}s)"
elapsed=0
while [ "$elapsed" -lt "$POLL_TIMEOUT_S" ]; do
  body="$(curl -sk https://localhost/api/dblp/status)"
  log "  $body"
  case "$body" in
    *'"ready":true'*)
      log "==> Import finished successfully."
      exit 0
      ;;
  esac
  sleep "$POLL_INTERVAL_S"
  elapsed=$((elapsed + POLL_INTERVAL_S))
done

log "==> Timed out after ${POLL_TIMEOUT_S}s waiting for readiness." >&2
echo "    Check the api container's own logs for the actual error:" >&2
echo "    sudo docker logs --tail 100 $API_CONTAINER" >&2
exit 1
