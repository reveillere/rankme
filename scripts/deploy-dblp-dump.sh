#!/usr/bin/env bash
# Deploys a new DBLP XML dump to a rankme server and triggers a full local
# reimport (decompress -> reindex -> rebuild the venue name index), the
# same manual flow used throughout local development (see api/src/admin.js
# -- extractVenues/processXML/venueLookup).
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
#   2. Triggers the import via POST /api/admin/venues (needs ADMIN_TOKEN).
#   3. Polls GET /api/dblp/status until the import finishes (ready or
#      failed) or the timeout below is hit, printing progress the whole
#      time.
#
# WHAT IT DELIBERATELY DOES NOT DO: touch docker-compose, restart any
# container, or change anything about how the app runs. The api process
# itself already exposes /api/dblp/status (ready/importing/version) so the
# front end disables the DBLP tab with a clear message for the whole
# import -- no coordination needed here beyond triggering it and waiting.
#
# SAFETY / CAPACITY NOTE: this decompresses to a ~5.3GB XML file and
# rebuilds several multi-million-document MongoDB collections from
# scratch (drop + full reinsert) -- CPU and memory heavy, ~10-15 minutes
# on the hardware this was developed against. Do not run this against a
# host that hasn't been sized for it (check available RAM/disk first --
# `ssh <host> 'free -h; df -h /var/lib/docker'`). The rest of the site
# (HAL, author/team pages, everything not DBLP) is unaffected while this
# runs; only the DBLP tab goes into its "importing" state.
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

POLL_INTERVAL_S=15
POLL_TIMEOUT_S=1800  # 30 minutes -- generous margin over the observed ~10-15 min

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
