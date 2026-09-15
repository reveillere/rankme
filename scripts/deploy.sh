#!/usr/bin/env bash
# Ships this branch's current HEAD to a rankme server: runs the full local
# test suite (and front lint) as a pre-deploy gate, pushes, pulls on the
# server, rebuilds api+front, waits for both to report healthy, then
# smoke-tests the live deployment -- the same checks done by hand after
# every deploy so far.
#
# Tests run LOCALLY, not on the server: api's suite (node --test) needs no
# devDependencies so it could run against the built prod image, but front's
# (vitest) does, and docker-compose.prod.yml's front image is the final
# nginx-only stage with no node/npm in it at all -- running tests wherever
# the full dev toolchain already exists is simpler than adding a dedicated
# test stage to the Dockerfile just for this.
#
# USAGE:
#   ./scripts/deploy.sh [ssh-host] [remote-app-dir] [api-container-name] [front-container-name]
#
# EXAMPLE:
#   ./scripts/deploy.sh vps

set -euo pipefail

SSH_HOST="${1:-vps}"
REMOTE_DIR="${2:-~/rankme}"
API_CONTAINER="${3:-rankme-api-1}"
FRONT_CONTAINER="${4:-rankme-front-1}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Running api test suite"
(cd "$REPO_ROOT/api" && npm test)

echo "==> Running front test suite"
(cd "$REPO_ROOT/front" && npm test)

echo "==> Linting front"
(cd "$REPO_ROOT/front" && npm run lint)

echo "==> Checking for uncommitted changes"
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "Uncommitted changes present -- commit or stash before deploying:" >&2
  git -C "$REPO_ROOT" status --short >&2
  exit 1
fi

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "On branch '$BRANCH', not main -- refusing to deploy a non-main branch." >&2
  exit 1
fi

echo "==> Pushing $BRANCH to origin"
git -C "$REPO_ROOT" push origin "$BRANCH"

echo "==> Pulling latest on $SSH_HOST"
ssh "$SSH_HOST" "cd $REMOTE_DIR && git pull origin main"

echo "==> Rebuilding and restarting api + front on $SSH_HOST"
ssh "$SSH_HOST" "cd $REMOTE_DIR && sudo docker compose -f docker-compose.prod.yml up -d --build api front"

echo "==> Waiting for api and front to report healthy"
for container in "$API_CONTAINER" "$FRONT_CONTAINER"; do
  health=""
  for _ in $(seq 1 20); do
    health="$(ssh "$SSH_HOST" "sudo docker inspect --format '{{.State.Health.Status}}' $container" 2>/dev/null || true)"
    [ "$health" = "healthy" ] && break
    sleep 3
  done
  if [ "$health" != "healthy" ]; then
    echo "$container did not report healthy in time (last status: ${health:-unknown})" >&2
    exit 1
  fi
done

# https + -k, not plain http: nginx.conf.prod redirects any non-https
# request to https (301) -- see scripts/deploy-dblp-dump.sh's identical
# note. -k skips cert verification since this is loopback traffic on the
# box itself.
echo "==> Smoke-testing the live deployment"

status_body="$(ssh "$SSH_HOST" "curl -sk https://localhost/api/dblp/status")"
echo "  /api/dblp/status: $status_body"
case "$status_body" in
  *'"ready":true'*) ;;
  *) echo "DBLP status not ready after deploy" >&2; exit 1 ;;
esac

front_code="$(ssh "$SSH_HOST" "curl -sk -o /dev/null -w '%{http_code}' https://localhost/")"
echo "  / (front): HTTP $front_code"
if [ "$front_code" != "200" ]; then
  echo "Front did not return 200" >&2
  exit 1
fi

search_body="$(ssh "$SSH_HOST" "curl -sk 'https://localhost/api/dblp/search/reveillere'")"
echo "  /api/dblp/search/reveillere: $search_body"
case "$search_body" in
  '['*']'*) ;;
  *) echo "DBLP search did not return a JSON array" >&2; exit 1 ;;
esac

echo "==> Deploy finished successfully."
