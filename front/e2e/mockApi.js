// Mocked RankMe API for the end-to-end tests. Every /api/* call the page
// makes is answered here from small fixtures, so the tests exercise the
// real built front end without Mongo, Redis, DBLP, HAL, CORE or SJR.
// Any call not handled below fails the test (see unhandled), so a new
// endpoint the UI starts depending on shows up immediately.

export const AUTHOR = { pid: '00/0001', name: 'Ada Example' };
export const COLLEAGUE = { pid: '00/0002', name: 'Ada Colleague' };

const coreRank = (value, title, acronym) => ({
  value, rawValue: null, source: 'CORE2023', matchType: 'exact',
  matchedTitle: title, matchedAcronym: acronym, matchedId: 1, distance: 0,
  currentSource: 'CORE2023', currentValue: value, currentRawValue: null,
});
const sjrRank = (value, title) => ({
  value, rawValue: null, source: 'SJR2024', matchType: 'exact',
  matchedTitle: title, matchedAcronym: null, matchedId: 2, distance: 0,
});

const pub = (type, key, title, venue, year) => ({
  type,
  venue,
  authors: [{ $: { pid: AUTHOR.pid }, _: AUTHOR.name }, { $: {}, _: 'Bob Coauthor' }],
  dblp: { title, year: String(year), key, url: `db/${key}.html`, ee: `https://doi.org/10.0000/${key}` },
});

export const PUBLICATIONS = [
  pub('inproceedings', 'conf/icse/Example24', 'Testing Things at Scale.', 'ICSE', 2024),
  pub('article', 'journals/tse/Example23', 'A Journal Study of Things.', 'IEEE Trans. Software Eng.', 2023),
  pub('inproceedings', 'conf/ase/Example21', 'Automated Things.', 'ASE', 2021),
  pub('informal', 'journals/corr/Example20', 'An Arxiv Preprint.', 'CoRR', 2020),
];

const RANKS = [
  coreRank('A*', 'International Conference on Software Engineering', 'ICSE'),
  sjrRank('Q1', 'IEEE Transactions on Software Engineering'),
  coreRank('A', 'Automated Software Engineering Conference', 'ASE'),
];

function sse(events) {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function authorStream() {
  const rankable = PUBLICATIONS.map((p, i) => [p, i]).filter(([p]) => p.type === 'inproceedings' || p.type === 'article');
  const total = rankable.length;
  return sse([
    ['init', { publications: PUBLICATIONS, total }],
    ['started', {}],
    ...rankable.map(([, index], n) => ['rank', { index, completed: n + 1, total, rank: RANKS[n] }]),
    ['done', {}],
  ]);
}

export const STRUCTURE = { id: '123456', name: 'Example Lab' };
export const HAL_ID = 'ada-example';

const halPub = (docid, type, title, venue, year) => ({
  docid, title, type, year, venue, doi: null, arxivId: null,
  authors: [{ name: AUTHOR.name, idHal: HAL_ID, form: null }, { name: 'Bob Coauthor', idHal: null, form: null }],
  url: `https://hal.science/hal-${docid}`,
});

export const HAL_PUBLICATIONS = [
  halPub('1001', 'COMM', 'Testing Things at Scale', 'International Conference on Software Engineering', 2024),
  halPub('1002', 'ART', 'A Journal Study of Things', 'IEEE Transactions on Software Engineering', 2023),
  halPub('1003', 'COUV', 'A Book Chapter', null, 2022),
];

function structureStream() {
  const total = 2;
  return sse([
    ['init', { publications: HAL_PUBLICATIONS, total, memberIds: [HAL_ID] }],
    ['started', {}],
    ['rank', { index: 0, completed: 1, total, rank: RANKS[0] }],
    ['rank', { index: 1, completed: 2, total, rank: RANKS[1] }],
    ['done', {}],
  ]);
}

// DBLP -> HAL cross-check: the ICSE paper is in HAL (confirmed), the ASE
// paper is not (missing), and the TSE article only has a fuzzy candidate
// (to review).
function crossCheckReport() {
  const [icse, tse, ase] = PUBLICATIONS;
  return {
    dblpStatus: { version: 'e2e', importedAt: '2026-01-01T00:00:00.000Z' },
    halCacheNote: 'HAL data may be up to 24h stale',
    results: [
      { publication: { ...icse, rank: RANKS[0] }, status: 'confirmed', matches: [{ halPub: HAL_PUBLICATIONS[0], confidence: 'exact' }] },
      { publication: { ...tse, rank: RANKS[1] }, status: 'to-review', matches: [{ halPub: { ...HAL_PUBLICATIONS[1], rank: RANKS[1] }, confidence: 'fuzzy', distance: 2 }] },
      { publication: { ...ase, rank: RANKS[2] }, status: 'missing', matches: [] },
    ],
  };
}

const authorName = (pid) => (decodeURIComponent(pid) === COLLEAGUE.pid ? COLLEAGUE.name : AUTHOR.name);

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const routes = [
  [/^\/api\/dblp\/status$/, () => json({ ready: true, importing: false, version: 'e2e', importedAt: '2026-01-01T00:00:00.000Z', doi: null })],
  [/^\/api\/ranking-editions$/, () => json({ core: 'CORE2023', sjr: 2024, ccf: 2022, coreYears: [2021, 2023], sjrYears: { start: 1999, end: 2024 } })],
  [/^\/api\/dblp\/search\/(.+)$/, (m) => json(decodeURIComponent(m[1]).toLowerCase().includes('ada')
    ? [AUTHOR, COLLEAGUE].map(a => ({ author: a.name, pid: a.pid, affiliation: [] }))
    : [])],
  [/^\/api\/dblp\/author\/(.+)$/, (m) => json({ dblpperson: { $: { name: authorName(m[1]) } } })],
  [/^\/api\/dblp\/author-info\/(.+)$/, (m) => json({ pid: decodeURIComponent(m[1]), orcid: null, name: authorName(m[1]) })],
  [/^\/api\/dblp\/author-stream\/(.+)$/, () => ({ status: 200, contentType: 'text/event-stream', body: authorStream() })],
  [/^\/api\/identity\/suggest\/(.+)$/, () => json({ idHal: null })],
  [/^\/api\/match-overrides\/shared\/(.+)$/, () => json([])],
  [/^\/api\/auth\/me$/, () => json({ error: 'Not signed in' }, 401)],
  [/^\/api\/sync\/state$/, () => json({ error: 'Not signed in' }, 401)],
  [/^\/api\/hal\/search\/(.+)$/, () => json([])],
  [/^\/api\/hal\/structure-info\/(.+)$/, (m) => json({ id: m[1], name: STRUCTURE.name })],
  [/^\/api\/hal\/structure-stream\/(.+)$/, () => ({ status: 200, contentType: 'text/event-stream', body: structureStream() })],
  [/^\/api\/crosscheck\/author\/(.+)$/, () => json(crossCheckReport())],
];

// Installs the mock on a Playwright page. Returns the list of API paths
// that no route handled, for the test to assert on.
export async function mockApi(page) {
  const unhandled = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    for (const [re, handler] of routes) {
      const m = url.pathname.match(re);
      if (m) return route.fulfill(handler(m, url, route.request()));
    }
    unhandled.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill(json({ error: 'not mocked in e2e' }, 501));
  });
  // Third-party scripts and icons the page loads; not needed for the tests.
  await page.route('**/analytics/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(/^https:\/\/(dblp\.org|hal\.science)\//, (route) => route.fulfill({ status: 204, body: '' }));
  return unhandled;
}
