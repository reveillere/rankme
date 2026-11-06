// Mocked RankMe API for the end-to-end tests. Every /api/* call the page
// makes is answered here from small fixtures, so the tests exercise the
// real built front end without Mongo, Redis, DBLP, HAL, CORE or SJR.
// Any call not handled below fails the test (see unhandled), so a new
// endpoint the UI starts depending on shows up immediately.

export const AUTHOR = { pid: '00/0001', name: 'Ada Example' };

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

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const routes = [
  [/^\/api\/dblp\/status$/, () => json({ ready: true, importing: false, version: 'e2e', importedAt: '2026-01-01T00:00:00.000Z', doi: null })],
  [/^\/api\/ranking-editions$/, () => json({ core: 'CORE2023', sjr: 2024, ccf: 2022, coreYears: [2021, 2023], sjrYears: { start: 1999, end: 2024 } })],
  [/^\/api\/dblp\/search\/(.+)$/, (m) => json(decodeURIComponent(m[1]).toLowerCase().includes('ada')
    ? [{ author: AUTHOR.name, pid: AUTHOR.pid, affiliation: [] }]
    : [])],
  [/^\/api\/dblp\/author\/(.+)$/, () => json({ dblpperson: { $: { name: AUTHOR.name } } })],
  [/^\/api\/dblp\/author-info\/(.+)$/, (m) => json({ pid: m[1], orcid: null, name: AUTHOR.name })],
  [/^\/api\/dblp\/author-stream\/(.+)$/, () => ({ status: 200, contentType: 'text/event-stream', body: authorStream() })],
  [/^\/api\/identity\/suggest\/(.+)$/, () => json({ idHal: null })],
  [/^\/api\/match-overrides\/shared\/(.+)$/, () => json([])],
  [/^\/api\/auth\/me$/, () => json({ error: 'Not signed in' }, 401)],
  [/^\/api\/hal\/search\/(.+)$/, () => json([])],
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
