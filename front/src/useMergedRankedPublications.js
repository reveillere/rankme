import { useEffect, useState } from 'react';

// Per-source stream endpoint + dedup key. DBLP publications carry their
// DBLP url (stripped of any '#' fragment — the same key already used for
// venue/rank caching in api/src/dblp.js); HAL publications carry their
// unique docid. Either way, a paper co-authored by two team members is
// counted once — first occurrence wins.
const SOURCE_CONFIG = {
  dblp: {
    streamUrl: (id) => `/api/dblp/author-stream/${id}`,
    dedupKey: (pub) => pub.dblp?.url?.split('#')[0],
  },
  hal: {
    streamUrl: (id) => `/api/hal/author-stream/${id}`,
    dedupKey: (pub) => pub.docid,
  },
};

function mergeByKey(memberPubsList, dedupKey) {
  const seen = new Map();
  for (const pubs of memberPubsList) {
    for (const pub of pubs) {
      const key = dedupKey(pub);
      if (!key || seen.has(key)) continue;
      seen.set(key, pub);
    }
  }
  return [...seen.values()];
}

// A "team" is just several same-source authors whose
// /api/{dblp,hal}/author-stream/:id SSE streams (the same endpoints
// Author.js/AuthorHal.js use for a single author) are composed client-side
// into one merged, deduplicated ranking — no backend changes needed.
// Returns the same shape as useRankedPublications so it's a drop-in for the
// existing single-author rendering path.
export function useMergedRankedPublications(source, members) {
  const [publications, setPublications] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const memberKey = (members || []).map(m => m.id).join(',');
  const config = SOURCE_CONFIG[source];

  useEffect(() => {
    setPublications(null);
    setProgress({ completed: 0, total: 0 });
    setDone(false);
    setFailed(false);

    if (!members || members.length === 0) {
      setPublications([]);
      setDone(true);
      return;
    }

    const memberPubs = members.map(() => null);
    const memberProgress = members.map(() => ({ completed: 0, total: 0 }));
    const memberDone = members.map(() => false);
    const memberFailed = members.map(() => false);

    const publish = () => {
      if (memberPubs.some(p => p === null)) return; // wait for every member's `init`
      setPublications(mergeByKey(memberPubs, config.dedupKey));
      setProgress({
        completed: memberProgress.reduce((sum, p) => sum + p.completed, 0),
        total: memberProgress.reduce((sum, p) => sum + p.total, 0),
      });
      setDone(memberDone.every(Boolean));
      setFailed(memberFailed.every(Boolean));
    };

    const sources = members.map((member, i) => {
      const es = new EventSource(config.streamUrl(member.id));

      es.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        memberPubs[i] = data.publications;
        memberProgress[i] = { completed: 0, total: data.total };
        publish();
      });

      es.addEventListener('rank', (e) => {
        const { index, completed, total, ...extra } = JSON.parse(e.data);
        if (memberPubs[i]) {
          const next = [...memberPubs[i]];
          next[index] = { ...next[index], ...extra };
          memberPubs[i] = next;
        }
        memberProgress[i] = { completed, total };
        publish();
      });

      es.addEventListener('error', (e) => {
        try {
          const { completed, total } = JSON.parse(e.data);
          memberProgress[i] = { completed, total };
          publish();
        } catch {
          // connection-level error, no payload to parse
        }
      });

      es.addEventListener('done', () => {
        memberDone[i] = true;
        publish();
        es.close();
      });

      // A member whose stream never even starts (e.g. bad id) must not
      // block the merge forever — treat it as contributing zero
      // publications rather than leaving memberPubs[i] stuck at null.
      es.onerror = () => {
        if (memberPubs[i] === null) memberPubs[i] = [];
        memberFailed[i] = true;
        memberDone[i] = true;
        publish();
        es.close();
      };

      return es;
    });

    return () => sources.forEach(es => es.close());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, memberKey]);

  return { publications, progress, done, failed };
}
