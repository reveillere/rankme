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

## Protected API tokens

The documented API at `/api/docs/` exposes only protected record and cross-check endpoints. Set `API_TOKENS` in the production `.env` to one or more comma-separated secrets:

```sh
openssl rand -hex 32
# .env
API_TOKENS=alice:first-generated-token,partner:second-generated-token
```

Restart the API after changing the value:

```sh
docker compose -f docker-compose.prod.yml up -d --build api
```

The optional prefix before `:` is an administrative label to remember who received the token; it is not part of the secret and is never exposed by the API. Tokens are compared server-side and are never stored in MongoDB or included in the application bundle.

### Lifecycle

To issue a token, generate a new secret and append a labelled entry:

```env
API_TOKENS=laurent-reveillere:existing-secret,olivier-barais:new-secret
```

Give the recipient only `new-secret`, never the label or the complete `.env` line. To revoke access, remove that person’s complete `label:secret` entry and restart the API. To rotate a token without interruption, add a new labelled entry, give the new secret to its recipient, then remove the old entry after they have switched. Replacing the complete list revokes every previous token.

Call the API with either `X-API-Token` or a bearer token:

```sh
curl -H 'X-API-Token: your-token' https://rankme.fr/api/dblp/author/11/1262
# equivalent:
curl -H 'Authorization: Bearer your-token' https://rankme.fr/api/dblp/author/11/1262
```

The browser interface uses its internal routes and does not require an API token. Local development reads `API_TOKENS` from `.env`, falling back to `dev-api-token` when it is absent.
