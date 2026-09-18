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

## Personal links and cross-check decisions

Identity choices and publication-pair decisions belong to the current browser:
`rankme:identityLinks` and `rankme:crosscheckDecisions` in localStorage.
Settings exposes **My identity links** and **My cross-check decisions** to
review, import/export, and delete/undo personal choices.

To collaborate on an author, structure, or team:

1. Open its **Identity links** panel and export JSON (CSV is also supported).
2. On its cross-check page, open **My cross-check decisions** and export JSON.
   This is a decisions file, distinct from the existing report export.
3. Your colleague opens the same author/structure/team, imports the links
   first, then imports the decisions file.

Exports include only the selected scope, across all years (independent of the
report's year filter). Automatic ORCID links displayed in the links panel can
also be exported; importing them makes them personal choices in the receiving
browser. Imports merge with local data. Incoming choices replace the same
identity/publication-pair entry; unrelated entries are preserved. Invalid,
contradictory, or out-of-scope files are rejected atomically. A PID already
assigned to another HAL identity must be unlinked before importing a conflicting
assignment. The global Settings panels accept files spanning multiple scopes.

JSON files use `{format: "rankme-personal-data", version: 1,
kind: "identity-links" | "crosscheck-decisions", scope, entries}`.
Legacy identity-link arrays and `idHal,pid` CSV remain importable.
Cross-check entries contain `dblpKey`, `halDocid`, and
`decision: "same" | "different"`.

The server computes automatic matches. It accepts personal identity links for
one calculation without persisting them or caching a personalized structure
report. Decisions are applied in the browser, including report exports, and
undo immediately restores the automatic result. Changes also refresh other
open tabs on the same origin. Clearing browser storage removes these choices;
keep exported files as backups.

### Transition from global decisions

The old MongoDB collections `rankme.personLinks` and
`rankme.crosscheckOverrides` are retained but no longer read or written.
They are not silently copied to every visitor: historical entries cannot be
reliably attributed to an individual browser. An administrator can export
selected old records for explicit import as personal files (links accept
legacy arrays; decisions accept arrays of the three fields above).

The old global identity CRUD routes and `POST /crosscheck/override` are
removed. Deploy the updated front and API together. Protected API callers may
still supply `identityLinks` as an array or the versioned export, scoped to
their request. Community venue-match corrections remain a separate feature.
