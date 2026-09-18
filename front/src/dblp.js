export const dblpCategories = {
    'article': { name: 'Journal articles', letter: 'j', color: '#c32b72' },
    'inproceedings': { name: 'Conference and Workshop Papers', letter: 'c', color: '#196ca3' },
    'proceedings': { name: 'Editorship', letter: 'e', color: '#33c3ba' },
    'book': { name: 'Books and Theses', letter: 'b', color: '#f8c91f' },
    'incollection': { name: 'Parts in Books or Collections', letter: 'p', color: '#ef942d' },
    'informal': { name: 'Informal and Other Publications', letter: 'i', color: '#606b70' },
}




export async function searchAuthor(query) {
    const resp = await fetch(`/api/dblp/search/${query}`);
    return await resp.json();
}

export async function fetchAuthor(authorPID, { signal, timeoutMs = 15_000 } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        const resp = await fetch(`/api/dblp/author/${authorPID}`, { signal: controller.signal });
        const body = await resp.json().catch(() => null);
        if (!resp.ok) {
            if (resp.status === 404) throw new Error(`No DBLP author found for PID ${authorPID}.`);
            if (resp.status === 503 && typeof body?.error === 'string' && body.error.startsWith('DBLP local dump')) {
                throw new Error(`${body.error}. Please try again later.`);
            }
            throw new Error(`The RankMe API is unavailable (HTTP ${resp.status}). Please try again.`);
        }
        if (typeof body?.dblpperson?.$?.name !== 'string' || !body.dblpperson.$.name.trim()) {
            throw new Error('The RankMe API returned an invalid author response. Please try again.');
        }
        return body;
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timedOut) throw new Error('Loading this author timed out. Please try again.');
        if (error instanceof TypeError) throw new Error('Cannot reach the RankMe API. Check your connection and try again.');
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

// { pid, orcid } -- orcid is null when this dblp author's homepage record
// carries none (see api/src/dblpLocal.js's getAuthorOrcid for why this
// isn't a dedicated dblp field).
export async function fetchAuthorInfo(pid) {
  const resp = await fetch(`/api/dblp/author-info/${pid}`);
  return await resp.json();
}

// { ready, importing, version } -- version is the imported dump's MD5,
// null until the first successful import. Polled by Search.js to disable
// the DBLP tab with a clear message while a (re)import is in progress,
// since the collections it reads are dropped and rebuilt in place (see
// admin.js's processXML) rather than swapped in atomically.
export async function fetchStatus(options) {
    const resp = await fetch('/api/dblp/status', options);
    if (!resp.ok) throw new Error(`DBLP status: HTTP ${resp.status}`);
    return await resp.json();
}


export function getName(author) {
    return author?.dblpperson?.$?.name;
}
