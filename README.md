# RankMe

RankMe looks up an author on [DBLP](https://dblp.org) or [HAL](https://hal.science), pulls their publication list, and ranks each venue against [CORE](http://portal.core.edu.au/conf-ranks/) (conferences) and [SJR/Scimago](https://www.scimagojr.com/) (journals) — with charts and filters (by year, category, rank) over the result.

Live at [rankme.fr](https://rankme.fr).

## Architecture

Five services, run with Docker Compose:

| Service        | What it is                                              |
|----------------|-----------------------------------------------------------|
| `reverseproxy` | nginx — TLS termination in prod, routes `/` to `front` and `/api/` to `api` |
| `front`        | React (Vite) SPA — author search, publication list, stats/filters |
| `api`          | Express — fetches/caches DBLP, HAL, CORE and SJR data, computes ranks |
| `mongo`        | Durable store: CORE/SJR rank tables and DBLP venue-name lookups |
| `redis`        | Cache only (24h TTL) — search results, author XML, rank lookups. Disposable: everything in it is re-derivable from DBLP/HAL/CORE/SJR on a cache miss |

`api` talks to DBLP/HAL/CORE/SJR through a shared rate limiter (`api/src/throttler.js`) — these are external services with their own rate limits, and getting throttling wrong here has actually taken the app's DBLP integration down for hours before, so don't loosen it without a reason.

## Running locally

```sh
docker compose -f docker-compose.dev.yml up -d --build
```

The app is then at **http://localhost:8080**. `front/src` and `api/src` are bind-mounted, so edits hot-reload without a rebuild — only rebuild (`--build`) after changing `package.json`, a `Dockerfile`, or `docker-compose.dev.yml` itself.

Mongo and Redis are also published to the host (`27017`, `6379`) for local inspection with your usual GUI/CLI tools.

```sh
docker compose -f docker-compose.dev.yml ps        # container + healthcheck status
docker compose -f docker-compose.dev.yml logs -f api
```

## Tests & lint

```sh
cd front && npm test && npm run lint   # vitest + eslint
cd api   && npm test                   # node's built-in test runner
```

Both run in CI (`.github/workflows/ci.yml`) on every push/PR, along with `docker compose -f docker-compose.dev.yml build` as a smoke test. Coverage is intentionally narrow so far — pure logic only (`levenshtein.js`'s venue-name matching, `filterPublications.js`'s filter chain) — not the DBLP/HAL/CORE/SJR fetch paths or the UI itself.

## `db-dump/`

A `mongodump` snapshot of the `scimagojr`, `dblp` (venue names), and `admin`/CORE-related collections — not automated, not restored automatically. To load it into a running dev stack:

```sh
docker compose -f docker-compose.dev.yml exec mongo mongorestore /data/db-dump
```

To take a fresh one:

```sh
docker compose -f docker-compose.dev.yml exec mongo mongodump --out /data/db-dump
```

Redis needs no equivalent — see the table above, it's cache only.

For ongoing backups (not a one-off dump), `scripts/backup-mongo.sh` wraps `mongodump` with rotation; see the comments at the top for wiring it into cron and pointing it somewhere off this box.

## Deploying

```sh
./deploy.sh
```

Issues a Let's Encrypt certificate for `rankme.fr` (first run only — subsequent deploys should skip the `certbot` line and just rebuild), then brings up `docker-compose.prod.yml`. Prod expects a real TLS cert to already exist at `/etc/letsencrypt/live/rankme.fr/` on the host (bind-mounted read-only into `reverseproxy`) and only publishes port `443` — `mongo`/`redis` are not reachable outside the Docker network.

## Environment

`MONGO_URI` / `REDIS_URI` are set directly in both compose files — not secrets, since neither service has authentication configured (deliberately: both are internal-only in prod, never published to the host). If a real credential is ever needed (e.g. an API key to work around a DBLP/HAL rate limit), there's no `.env` convention here yet — add one rather than hardcoding it into a committed compose file.
