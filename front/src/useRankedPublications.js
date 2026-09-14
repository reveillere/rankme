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
  // True from `init` until the server's own 'started' event (or the first
  // actual rank/rank-error/done) arrives -- distinguishes "queued behind
  // other work, nothing computed yet" from "actively computing, 0 of N
  // done so far", which otherwise look identical (completed stays 0 in
  // both). See ranking.js's identical comment on why this needed its own
  // signal rather than being inferrable from progress alone.
  const [queued, setQueued] = useState(false);
  // A snapshot from the server's own 'queued' event ("this many were ahead
  // of you when you joined the queue") -- not a live countdown, see
  // ranking.js's ConcurrencyLimiter.position for why. null whenever queued
  // is false, or if the stream never queued long enough to get one at all.
  const [queuePosition, setQueuePosition] = useState(null);
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
    setQueued(false);
    setQueuePosition(null);
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
      setQueued(data.total > 0);
    });

    // Only sent when there's actually something ahead (see ranking.js) --
    // a stream that starts running immediately never gets one at all.
    es.addEventListener('queued', (e) => {
      setQueuePosition(JSON.parse(e.data).position);
    });

    // Fired once by the server the moment this stream's own work actually
    // starts running (as opposed to sitting behind other requests in
    // ranking_limiter) -- see ranking.js's identical comment.
    es.addEventListener('started', () => {
      setQueued(false);
      setQueuePosition(null);
    });

    es.addEventListener('rank', (e) => {
      const { index, completed, total, ...extra } = JSON.parse(e.data);
      if (publicationsRef.current) {
        publicationsRef.current[index] = { ...publicationsRef.current[index], ...extra };
      }
      progressRef.current = { completed, total };
      setQueued(false); // defensive: a rank event can only follow 'started'
      setQueuePosition(null);
      scheduleFlush();
    });

    // Named 'rank-error' server-side, deliberately not 'error': EventSource
    // dispatches a server-sent event named 'error' through the exact same
    // listeners (this one AND onerror below) as a genuine connection
    // failure, so onerror would treat one failed publication as the whole
    // stream dying and close it before 'done' ever arrives -- this is what
    // "stuck at N%, never reaches 100%" turned out to be on any structure
    // with at least one per-item ranking error.
    es.addEventListener('rank-error', (e) => {
      progressRef.current = JSON.parse(e.data);
      setQueued(false);
      setQueuePosition(null);
      scheduleFlush();
    });

    es.addEventListener('done', () => {
      if (flushTimerRef.current != null) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      flush();
      setDone(true);
      setQueued(false);
      setQueuePosition(null);
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

  return { publications, progress, done, failed, queued, queuePosition };
}
