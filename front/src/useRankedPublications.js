import { useEffect, useRef, useState } from 'react';

// How often a burst of 'rank' events gets flushed into React state, in ms.
// A large structure (e.g. LaBRI: ~7800 publications) streams thousands of
// 'rank' events within a few seconds -- re-rendering (and, see below,
// re-copying the whole publications array) on every single one made the
// tab unresponsive well before the stream even finished (multi-second
// INP, since the main thread never got a chance to breathe). Flushing on a
// timer instead caps the render rate to wall-clock time regardless of how
// fast the backend produces ranks, while still feeling live.
const FLUSH_INTERVAL_MS = 150;

export function useRankedPublications(streamUrl) {
  const [publications, setPublications] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  // Mutated directly by each 'rank' event, in place -- no per-event array
  // copy or re-render, unlike the `publications` state above (which is
  // only ever replaced by a *reference* to this same array, on the
  // flush timer, so React only diffs/re-renders the DOM list at that
  // capped rate too).
  const publicationsRef = useRef(null);
  const progressRef = useRef({ completed: 0, total: 0 });
  const flushTimerRef = useRef(null);

  useEffect(() => {
    publicationsRef.current = null;
    progressRef.current = { completed: 0, total: 0 };
    setPublications(null);
    setDone(false);
    setProgress({ completed: 0, total: 0 });
    setFailed(false);
    if (!streamUrl) return;

    const es = new EventSource(streamUrl);

    const flush = () => {
      flushTimerRef.current = null;
      if (publicationsRef.current) setPublications([...publicationsRef.current]);
      setProgress(progressRef.current);
    };
    const scheduleFlush = () => {
      if (flushTimerRef.current == null) flushTimerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
    };

    es.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      publicationsRef.current = data.publications;
      progressRef.current = { completed: 0, total: data.total };
      setPublications(data.publications);
      setProgress(progressRef.current);
    });

    es.addEventListener('rank', (e) => {
      const { index, completed, total, ...extra } = JSON.parse(e.data);
      if (publicationsRef.current) {
        publicationsRef.current[index] = { ...publicationsRef.current[index], ...extra };
      }
      progressRef.current = { completed, total };
      scheduleFlush();
    });

    es.addEventListener('error', (e) => {
      try {
        progressRef.current = JSON.parse(e.data);
        scheduleFlush();
      } catch {
        // connection-level error, no payload to parse
      }
    });

    es.addEventListener('done', () => {
      if (flushTimerRef.current != null) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      flush();
      setDone(true);
      es.close();
    });

    // Fires on a connection-level failure (e.g. the endpoint errored before
    // it could even start the stream — no `init` ever arrives) — without
    // this, the caller is left showing a loading spinner forever with no
    // way to tell the request failed.
    es.onerror = () => {
      setFailed(true);
      es.close();
    };

    return () => {
      es.close();
      if (flushTimerRef.current != null) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    };
  }, [streamUrl]);

  return { publications, progress, done, failed };
}
