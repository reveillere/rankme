const jsonResponse = (description = 'Successful response', example, extra = {}) => ({
  200: { description, content: { 'application/json': { schema: { type: 'object', additionalProperties: true }, ...(example ? { example } : {}) } } },
  400: { description: 'Invalid request' },
  401: { description: 'Missing or invalid API token' },
  500: { description: 'Server error' },
  ...extra,
});

const NOT_FOUND = { 404: { description: 'No record for the given identifier' } };
const CONFLICT = { 409: { description: 'The supplied identityLinks are malformed, or map one idHal or PID to more than one counterpart' } };
const DUMP_NOT_READY = { 503: { description: 'The local DBLP dump has not been imported yet, or a reimport is in progress' } };

const path = (name, description, example) => ({
  name, in: 'path', required: true, schema: { type: 'string', example }, description,
});

const rankingParameters = [
  { name: 'confSource', in: 'query', schema: { type: 'string', enum: ['core', 'ccf'], default: 'core' }, description: 'Conference ranking source.' },
  { name: 'journalSource', in: 'query', schema: { type: 'string', enum: ['sjr', 'ccf'], default: 'sjr' }, description: 'Journal ranking source.' },
];

const recordPresentationParameters = [
  { name: 'from', in: 'query', schema: { type: 'integer', minimum: 1800 }, description: 'First publication year to include.' },
  { name: 'to', in: 'query', schema: { type: 'integer', minimum: 1800 }, description: 'Last publication year to include.' },
  { name: 'categories', in: 'query', style: 'form', explode: false, schema: { type: 'array', items: { type: 'string', enum: ['article', 'inproceedings', 'proceedings', 'book', 'incollection', 'informal'] } }, description: 'Comma-separated selected publication categories.' },
  { name: 'ranks', in: 'query', style: 'form', explode: false, schema: { type: 'array', items: { type: 'string' } }, description: 'Comma-separated selected rank values, for example A*,A,Q1. A record with no computed rank is never excluded by this filter.' },
  { name: 'sort', in: 'query', schema: { type: 'string', enum: ['date', 'date-rank', 'rank-date'], default: 'date' }, description: 'Result ordering.' },
  { name: 'export', in: 'query', schema: { type: 'string', enum: ['md', 'csv', 'json'] }, description: 'When set, the response is the rendered export (Content-Type text/markdown, text/csv or application/json) instead of the normal JSON envelope -- a lightweight snapshot (rank/authors/title/venue/type/doi per record), not a pixel-perfect mirror of the JSON response.' },
  { name: 'useCommunityCorrections', in: 'query', schema: { type: 'boolean', default: true }, description: 'Whether community-confirmed venue-match corrections are applied to rank.effectiveValue. Default true, matching the web app. Has no effect on CCF-sourced ranks (no community-correction data exists for CCF yet).' },
  { name: 'matchOverrides', in: 'query', schema: { type: 'string', format: 'json', example: '[{"portal":"core","rankSource":"ICORE2026","queryText":"AINA 2017","candidate":{"id":"conf-example","title":"...","value":"A"}}]' }, description: 'JSON array of personal venue-match corrections -- the exact format exported from the web app (Settings → My match corrections → Export JSON). Applied to rank.effectiveValue for this request only; never persisted server-side.' },
  { name: 'customRankings', in: 'query', schema: { type: 'string', format: 'json', example: '{"conference":{"id":"...","reference":"core","entries":{}},"journal":{"id":"...","reference":"ccf","entries":{}}}' }, description: 'JSON object {conference?, journal?}, each an optional custom-ranking profile (Settings → My custom rankings → Export JSON) to apply on that axis. The API also accepts a single-profile Front export, or the global Preferences export; an all-profiles export with multiple profiles is rejected unless it carries explicit active axis selections. A profile\'s own reference ranking (core/sjr/ccf) must be able to cover the axis it is placed under. Applied to rank.effectiveValue only; never persisted server-side.' },
];

const identityLinkEntries = {
  type: 'array',
  items: { type: 'object', required: ['idHal', 'pid'], properties: { idHal: { type: 'string', example: 'laurent-reveillere' }, pid: { type: 'string', example: '11/1262' } } },
};
const identityLinks = {
  description: 'Personal links for this request only; never persisted. Accepts a legacy array or the versioned Identity links JSON export. Each idHal and PID must map to only one counterpart.',
  oneOf: [
    identityLinkEntries,
    {
      type: 'object', required: ['format', 'version', 'kind', 'entries'],
      properties: {
        format: { type: 'string', enum: ['rankme-personal-data'] },
        version: { type: 'integer', enum: [1] },
        kind: { type: 'string', enum: ['identity-links'] },
        scope: { type: 'object', additionalProperties: true },
        entries: identityLinkEntries,
      },
    },
  ],
};

// No categories/ranks/sort here -- see crosscheckPresentation.js's own
// header comment for why: no crosscheck page in the web app has a
// category/rank filter or a sort control (verified directly against
// CrossCheck.js/CrossCheckStructure.js/CrossCheckTeam.js), so the API
// doesn't invent them either. from/to, export, matchOverrides,
// customRankings and useCommunityCorrections all mirror real web behavior
// (year filter on all 3 crosscheck pages; export via
// front/src/exportCrossCheck.js; corrections via RankBadge.js, which every
// crosscheck page already threads sharedMaps/activeCustomProfileIds into).
const crossCheckOptions = {
  from: { type: 'integer', minimum: 1800, example: 2015, description: 'First publication year to include.' },
  to: { type: 'integer', minimum: 1800, example: 2024, description: 'Last publication year to include.' },
  export: { type: 'string', enum: ['md', 'csv', 'json'], description: 'When set, the response is the rendered export instead of the normal JSON envelope -- same md/csv/json formats and fields as the record endpoints\' own export parameter, adapted to this endpoint\'s missing/to-review shape.' },
  identityLinks,
  useCommunityCorrections: {
    type: 'boolean', default: true,
    description: 'Whether community-confirmed venue-match corrections are applied to rank.effectiveValue, on both the DBLP publication and every HAL candidate in matches. Default true, matching the web app. Has no effect on CCF-sourced ranks (no community-correction data exists for CCF yet).',
  },
  customRankings: {
    type: 'string', format: 'json',
    example: '{"conference":{"id":"...","reference":"core","entries":{}},"journal":{"id":"...","reference":"ccf","entries":{}}}',
    description: 'JSON-encoded {conference?, journal?}, same format as the record endpoints\' own customRankings parameter -- see its description there for the exact contract.',
  },
  matchOverrides: {
    type: 'string', format: 'json',
    example: '[{"portal":"core","rankSource":"ICORE2026","queryText":"AINA 2017","candidate":{"id":"conf-example","title":"...","value":"A"}}]',
    description: 'JSON-encoded array of personal venue-match corrections, same format as the record endpoints\' own matchOverrides parameter.',
  },
};

const protectedOperation = operation => ({ ...operation, security: [{ apiToken: [] }] });

// effectiveValue mirrors rank.value here (no correction applies to this
// made-up example) -- see recordPresentationParameters' own matchOverrides/
// customRankings/useCommunityCorrections descriptions for when it differs.
const rankExample = { value: 'A', effectiveValue: 'A', source: 'core', matchType: 'exact', queryText: 'International Conference on Example Systems', matchedTitle: 'International Conference on Example Systems', matchedId: 'conf-example' };
const dblpAuthorExample = { author: { pid: '11/1262', name: 'Laurent Réveillère' }, records: [{ type: 'inproceedings', dblp: { key: 'conf/example/Reveillere22', title: 'A plausible DBLP publication', year: '2022' }, rank: rankExample }] };
const halRecordExample = [{ docid: 'hal-01234567', title: 'A plausible HAL publication', year: 2022, type: 'ART', authIdHalFullName_fs: ['laurent-reveillere_FacetSep_Laurent Réveillère'], rank: rankExample }];
const crossCheckExample = { dblpStatus: { version: 'example-dump', importedAt: '2026-09-17T00:00:00.000Z' }, halCacheNote: 'HAL data may be up to 24h stale', results: [{ status: 'missing', publication: { type: 'inproceedings', dblp: { key: 'conf/example/Smith22', title: 'A plausible DBLP publication', year: '2022' }, rank: rankExample }, matches: [] }] };
const teamCrossCheckExample = { ...crossCheckExample, members: [{ pid: '11/1262', idHal: 'laurent-reveillere', name: 'Laurent Réveillère', confirmedCount: 3, results: crossCheckExample.results }], unresolvedMembers: [], confirmedCount: 3 };

// This specification intentionally contains only the externally usable
// read-only record and cross-check API. Internal, administration and
// identity-link management routes are neither advertised nor documented.
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'RankMe API',
    version: '0.9.1',
    description: `**Beta:** this API is under active development. Endpoints, parameters and response shapes may still change without notice -- avoid depending on it for production use yet.

Protected read-only API for author and HAL structure records, plus cross-checks.

## Authentication

Every endpoint below requires an API token. In Swagger, click **Authorize** and enter a token. With an HTTP client, send either \`X-API-Token: <token>\` or \`Authorization: Bearer <token>\`.

## Web application URL options

The following parameters belong to RankMe *web page URLs*. They are applied by the browser and are not sent to the API endpoints below:

| Parameter | Values | Effect |
| --- | --- | --- |
| \`from\` | year, e.g. \`2015\` | First publication year included. |
| \`to\` | year, e.g. \`2024\` | Last publication year included. |
| \`sort\` | \`date\`, \`date-rank\`, \`rank-date\` | Record ordering: date only; date then rank; rank then date. |
| \`export\` | \`md\`, \`csv\`, \`json\` | Downloads the displayed records in that format. |

Examples: \`/dblp/11/1262?from=2015&to=2024&sort=date-rank\` and \`/structure/12345?export=csv\`.

## Record options

The four record endpoints below (\`/dblp/author/{pid}\`, \`/hal/author/{idHal}\`, \`/hal/structure/{structId}\`, \`/records/team\`) rank every returned record (CORE/SJR, or CCF when \`confSource\`/\`journalSource\` says so) and apply \`from\`, \`to\`, \`categories\`, \`ranks\` and \`sort\` server-side. Setting \`export\` replaces the normal JSON response with a rendered Markdown/CSV/JSON snapshot instead (see each endpoint's \`export\` parameter).

Each rankable record's \`rank\` also carries an \`effectiveValue\` alongside the raw automatic \`value\` -- the same value the web app's RankBadge would show once personal, community and custom-ranking corrections are taken into account. \`ranks\` filtering and \`rank-date\`/\`date-rank\` sorting both use \`effectiveValue\`. \`useCommunityCorrections\` (default true) toggles community-confirmed corrections; \`matchOverrides\` and \`customRankings\` let a request supply its own personal corrections/custom-ranking profiles -- see their own parameter descriptions above for the exact JSON shape. None of the three are persisted server-side; a request without them behaves exactly as if they were empty.

## Cross-check options

Cross-check POST requests accept \`identityLinks\`, the JSON content of an exported Identity links file. The links apply only to that request and override inferred identities. Personal cross-check decisions remain in the browser and are not applied to API responses. Legacy global identity links and cross-check decisions are no longer used. A malformed file, or a file that maps one idHal or PID to multiple counterparts, returns \`409 Conflict\` and no partial result.

\`from\`/\`to\` filter \`results\` (and, for \`/crosscheck/structure\`/\`/crosscheck/team\`, every member's own \`results\`) by publication year, the same year filter every crosscheck page in the web app now has. \`useCommunityCorrections\`, \`matchOverrides\` and \`customRankings\` attach \`rank.effectiveValue\` to both a result's own \`publication.rank\` and every HAL candidate's \`rank\` in \`matches\` -- same contract and JSON shape as the record endpoints' own parameters of the same name, just applied to this endpoint's missing/to-review shape instead of a flat record list. \`export\` renders the (year-filtered, correction-applied) report as Markdown/CSV/JSON instead of the normal JSON envelope.

Unlike the record endpoints (where these are query parameters), all of the above are read from the request body first, falling back to the query string -- the same place \`identityLinks\`, \`pid\`/\`halId\`/\`structId\`/\`source\`/\`pids\` already live for these endpoints.

\`categories\`, \`ranks\` and \`sort\` are deliberately not offered here: no crosscheck page in the web app has a category/rank filter or a sort control, unlike the record endpoints' own (see "Record options" above) -- the API mirrors what the product actually does, not a richer contract than it.

## Teams

Teams are stored locally in the web application, so there is no team-record GET endpoint. Use \`POST /crosscheck/team\` to compare a team by supplying its source and member identifiers.`,
  },
  servers: [{ url: '/api', description: 'Application API through the reverse proxy' }],
  tags: [
    { name: 'Records', description: 'Public record data, protected by an API token.' },
    { name: 'Cross-check', description: 'DBLP/HAL comparisons, protected by an API token.' },
  ],
  paths: {
    '/dblp/author/{pid}': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get DBLP records for an author',
        parameters: [path('pid', 'DBLP person identifier (PID).', '11/1262'), ...recordPresentationParameters, ...rankingParameters],
        responses: jsonResponse('DBLP author records', dblpAuthorExample, { ...NOT_FOUND, ...DUMP_NOT_READY }),
      }),
    },
    '/hal/author/{idHal}': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get HAL records for an author',
        parameters: [path('idHal', 'HAL author identifier (idHal).', 'laurent-reveillere'), ...recordPresentationParameters, ...rankingParameters], responses: jsonResponse('HAL author records', halRecordExample),
      }),
    },
    '/hal/structure/{structId}': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get HAL records for a structure',
        parameters: [path('structId', 'HAL structure identifier.', '12345'), ...recordPresentationParameters, ...rankingParameters], responses: jsonResponse('HAL structure records', halRecordExample),
      }),
    },
    '/records/team': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get merged, deduplicated records for a locally defined team',
        parameters: [...recordPresentationParameters, ...rankingParameters],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['source', 'pids'], properties: {
          source: { type: 'string', enum: ['dblp', 'hal'], example: 'dblp' },
          pids: { type: 'array', description: 'DBLP PIDs for source=dblp; HAL idHals for source=hal.', items: { type: 'string' }, example: ['11/1262', '12/3456'] },
          ...crossCheckOptions,
        } } } } }, responses: jsonResponse('Merged team records', { source: 'dblp', records: [{ type: 'inproceedings', dblp: { key: 'conf/example/Smith22', title: 'A plausible DBLP publication', year: '2022' }, rank: rankExample }] }),
      }),
    },
    '/crosscheck/author': {
      post: protectedOperation({
        tags: ['Cross-check'], summary: 'Cross-check one DBLP author against one HAL author',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['pid', 'halId'], properties: { pid: { type: 'string', example: '11/1262' }, halId: { type: 'string', example: 'laurent-reveillere' }, ...crossCheckOptions } } } } },
        parameters: rankingParameters, responses: jsonResponse('Comparison result', crossCheckExample, { ...NOT_FOUND, ...CONFLICT }),
      }),
    },
    '/crosscheck/structure': {
      post: protectedOperation({
        tags: ['Cross-check'], summary: 'Cross-check a HAL structure against DBLP identities',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['structId'], properties: { structId: { type: 'string', example: '12345' }, ...crossCheckOptions } } } } },
        parameters: rankingParameters, responses: jsonResponse('Structure comparison result', teamCrossCheckExample, CONFLICT),
      }),
    },
    '/crosscheck/team': {
      post: protectedOperation({
        tags: ['Cross-check'], summary: 'Cross-check a locally defined team', parameters: rankingParameters,
        requestBody: {
          required: true,
          description: 'Teams are local to the browser, so source and members are supplied by the caller.',
          content: { 'application/json': { schema: {
            type: 'object', required: ['source', 'pids'], properties: {
              source: { type: 'string', enum: ['dblp', 'hal'], example: 'dblp' },
              pids: { type: 'array', description: 'DBLP PIDs for source=dblp; HAL idHals for source=hal.', items: { type: 'string' }, example: ['11/1262', '12/3456'] },
              ...crossCheckOptions,
            },
          } } },
        }, responses: jsonResponse('Team comparison result', teamCrossCheckExample, CONFLICT),
      }),
    },
  },
  components: {
    securitySchemes: {
      apiToken: { type: 'apiKey', in: 'header', name: 'X-API-Token', description: 'A token listed in the API_TOKENS deployment setting.' },
    },
  },
};
