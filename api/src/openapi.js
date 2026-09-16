const jsonResponse = (description = 'Successful response', example) => ({
  200: { description, content: { 'application/json': { schema: { type: 'object', additionalProperties: true }, ...(example ? { example } : {}) } } },
  400: { description: 'Invalid request' },
  401: { description: 'Missing or invalid API token' },
  500: { description: 'Server error' },
});

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
  { name: 'ranks', in: 'query', style: 'form', explode: false, schema: { type: 'array', items: { type: 'string' } }, description: 'Comma-separated selected rank values.' },
  { name: 'sort', in: 'query', schema: { type: 'string', enum: ['date', 'date-rank', 'rank-date'], default: 'date' }, description: 'Result ordering.' },
  { name: 'export', in: 'query', schema: { type: 'string', enum: ['md', 'csv', 'json'] }, description: 'Requested export format.' },
  { name: 'useCommunityCorrections', in: 'query', schema: { type: 'boolean', default: true }, description: 'Whether community-confirmed venue corrections are included.' },
  { name: 'matchOverrides', in: 'query', schema: { type: 'string', format: 'json' }, description: 'JSON-encoded personal match-corrections file content.' },
  { name: 'customRankings', in: 'query', schema: { type: 'string', format: 'json' }, description: 'JSON-encoded custom-ranking file content.' },
];

const identityLinks = {
  type: 'array',
  description: 'Optional content of an exported Identity links JSON file. Used only for this request; it is not persisted. Each idHal and PID must occur at most once.',
  items: { type: 'object', required: ['idHal', 'pid'], properties: { idHal: { type: 'string', example: 'laurent-reveillere' }, pid: { type: 'string', example: '11/1262' } } },
};

const crossCheckOptions = {
  from: { type: 'integer', minimum: 1800, example: 2015, description: 'First publication year to include.' },
  to: { type: 'integer', minimum: 1800, example: 2024, description: 'Last publication year to include.' },
  categories: {
    type: 'array', uniqueItems: true,
    description: 'Publication categories selected in the interface.',
    items: { type: 'string', enum: ['article', 'inproceedings', 'proceedings', 'book', 'incollection', 'informal'] },
    example: ['article', 'inproceedings'],
  },
  ranks: {
    type: 'array', uniqueItems: true,
    description: 'Rank values selected in the interface, for example A*, A, B, C, Q1–Q4 or Unranked.',
    items: { type: 'string' }, example: ['A*', 'A', 'Q1'],
  },
  sort: { type: 'string', enum: ['date', 'date-rank', 'rank-date'], default: 'date', description: 'Result ordering.' },
  export: { type: 'string', enum: ['md', 'csv', 'json'], description: 'Requested representation of the filtered result.' },
  identityLinks,
  useCommunityCorrections: {
    type: 'boolean', default: true,
    description: 'Reserved for applying community-confirmed venue-match corrections to API rankings.',
  },
  customRankings: {
    type: 'object',
    description: 'Reserved for portable custom-ranking profiles, one per axis (conference and journal).',
    additionalProperties: true,
  },
  matchOverrides: {
    type: 'array',
    description: 'Reserved for a future per-request import of personal venue-match corrections. It is not applied yet.',
    items: { type: 'object' },
  },
};

const protectedOperation = operation => ({ ...operation, security: [{ apiToken: [] }] });

const dblpAuthorExample = { author: { pid: '11/1262', name: 'Laurent Réveillère' }, records: [{ type: 'inproceedings', dblp: { key: 'conf/example/Reveillere22', title: 'A plausible DBLP publication', year: '2022' } }] };
const halRecordExample = [{ docid: 'hal-01234567', title: 'A plausible HAL publication', year: 2022, type: 'ART', authIdHalFullName_fs: ['laurent-reveillere_FacetSep_Laurent Réveillère'] }];
const rankExample = { value: 'A', source: 'core', matchType: 'exact', queryText: 'International Conference on Example Systems', matchedTitle: 'International Conference on Example Systems', matchedId: 'conf-example' };
const crossCheckExample = { dblpStatus: { version: 'example-dump', importedAt: '2026-09-17T00:00:00.000Z' }, halCacheNote: 'HAL data may be up to 24h stale', results: [{ status: 'missing', publication: { type: 'inproceedings', dblp: { key: 'conf/example/Smith22', title: 'A plausible DBLP publication', year: '2022' }, rank: rankExample }, matches: [] }] };
const teamCrossCheckExample = { ...crossCheckExample, members: [{ pid: '11/1262', idHal: 'laurent-reveillere', name: 'Laurent Réveillère', confirmedCount: 3, results: crossCheckExample.results }], unresolvedMembers: [], confirmedCount: 3 };

// This specification intentionally contains only the externally usable
// read-only record and cross-check API. Internal, administration and
// identity-link management routes are neither advertised nor documented.
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'RankMe API',
    version: '0.7.0',
    description: `Protected read-only API for author and HAL structure records, plus cross-checks.

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

## Cross-check options

Cross-check POST requests accept \`identityLinks\`, the JSON content of an exported Identity links file. The links apply only to that request and override inferred identities. A malformed file, or a file that maps one idHal or PID to multiple counterparts, returns \`409 Conflict\` and no partial result.

\`from\`, \`to\`, \`categories\`, \`ranks\`, \`sort\`, \`export\`, \`useCommunityCorrections\`, \`matchOverrides\` and \`customRankings\` define the portable contract for browser-local display choices on both record and cross-check operations. Their server-side application is the next implementation step; they are documented now so the API shape is complete without claiming that a value has already changed a response.

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
        parameters: [path('pid', 'DBLP person identifier (PID).', '11/1262'), ...recordPresentationParameters], responses: jsonResponse('DBLP author records', dblpAuthorExample),
      }),
    },
    '/hal/author/{idHal}': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get HAL records for an author',
        parameters: [path('idHal', 'HAL author identifier (idHal).', 'laurent-reveillere'), ...recordPresentationParameters], responses: jsonResponse('HAL author records', halRecordExample),
      }),
    },
    '/hal/structure/{structId}': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get HAL records for a structure',
        parameters: [path('structId', 'HAL structure identifier.', '12345'), ...recordPresentationParameters], responses: jsonResponse('HAL structure records', halRecordExample),
      }),
    },
    '/records/team': {
      post: protectedOperation({
        tags: ['Records'], summary: 'Get merged, deduplicated records for a locally defined team',
        parameters: recordPresentationParameters,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['source', 'pids'], properties: {
          source: { type: 'string', enum: ['dblp', 'hal'], example: 'dblp' },
          pids: { type: 'array', description: 'DBLP PIDs for source=dblp; HAL idHals for source=hal.', items: { type: 'string' }, example: ['11/1262', '12/3456'] },
          ...crossCheckOptions,
        } } } } }, responses: jsonResponse('Merged team records', { source: 'dblp', records: [{ type: 'inproceedings', dblp: { key: 'conf/example/Smith22', title: 'A plausible DBLP publication', year: '2022' } }] }),
      }),
    },
    '/crosscheck/author': {
      post: protectedOperation({
        tags: ['Cross-check'], summary: 'Cross-check one DBLP author against one HAL author',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['pid', 'halId'], properties: { pid: { type: 'string', example: '11/1262' }, halId: { type: 'string', example: 'laurent-reveillere' }, ...crossCheckOptions } } } } },
        parameters: rankingParameters, responses: jsonResponse('Comparison result', crossCheckExample),
      }),
    },
    '/crosscheck/structure': {
      post: protectedOperation({
        tags: ['Cross-check'], summary: 'Cross-check a HAL structure against DBLP identities',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['structId'], properties: { structId: { type: 'string', example: '12345' }, ...crossCheckOptions } } } } },
        parameters: rankingParameters, responses: jsonResponse('Structure comparison result', teamCrossCheckExample),
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
        }, responses: jsonResponse('Team comparison result', teamCrossCheckExample),
      }),
    },
  },
  components: {
    securitySchemes: {
      apiToken: { type: 'apiKey', in: 'header', name: 'X-API-Token', description: 'A token listed in the API_TOKENS deployment setting.' },
    },
  },
};
