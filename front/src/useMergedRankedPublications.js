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

// Same rationale as useRankedPublications.js's own FLUSH_INTERVAL_MS: a
// team merges *every* member's SSE stream, so the combined 'rank' event
// rate -- and the cost of re-merging every member's publications on each
// one, see mergeByKey -- is worse than a single author's. Capping how
// often that merge (and the resulting re-render) happens keeps a
// many-member team with thousands of combined publications from making
// the tab unresponsive while ranks stream in.
const FLUSH_INTERVAL_MS = 150;

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

    let flushTimer = null;
    const publish = () => {
      if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
      if (memberPubs.some(p => p === null)) return; // wait for every member's `init`
      setPublications(mergeByKey(memberPubs, config.dedupKey));
      setProgress({
        completed: memberProgress.reduce((sum, p) => sum + p.completed, 0),
        total: memberProgress.reduce((sum, p) => sum + p.total, 0),
      });
      setDone(memberDone.every(Boolean));
      setFailed(memberFailed.every(Boolean));
    };
    // Immediate for init/done/error (rare, and callers need those
    // reflected right away -- e.g. "every member errored" for failed);
    // throttled for the bulk of 'rank' events, see FLUSH_INTERVAL_MS.
    const schedulePublish = () => {
      if (flushTimer == null) flushTimer = setTimeout(publish, FLUSH_INTERVAL_MS);
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
        // Mutated in place -- unlike the old `[...memberPubs[i]]` copy,
        // this doesn't cost O(member size) on every single event (and
        // doesn't need to: only the throttled publish() above actually
        // reads memberPubs into a new merged array for React).
        if (memberPubs[i]) memberPubs[i][index] = { ...memberPubs[i][index], ...extra };
        memberProgress[i] = { completed, total };
        schedulePublish();
      });

      // Named 'rank-error' server-side, deliberately not 'error' -- see
      // useRankedPublications.js's identical comment: EventSource routes a
      // server-sent event literally named 'error' through the same
      // listeners as a genuine connection failure, so onerror below would
      // treat one member's single failed publication as that whole
      // member's stream dying.
      es.addEventListener('rank-error', (e) => {
        const { completed, total } = JSON.parse(e.data);
        memberProgress[i] = { completed, total };
        schedulePublish();
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

    return () => {
      sources.forEach(es => es.close());
      if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, memberKey]);

  return { publications, progress, done, failed };
}
