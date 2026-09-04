import { useEffect, useState } from 'react';

export function useRankedPublications(streamUrl) {
  const [publications, setPublications] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPublications(null);
    setDone(false);
    setProgress({ completed: 0, total: 0 });
    setFailed(false);
    if (!streamUrl) return;

    const es = new EventSource(streamUrl);

    es.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      setPublications(data.publications);
      setProgress({ completed: 0, total: data.total });
    });

    es.addEventListener('rank', (e) => {
      const { index, completed, total, ...extra } = JSON.parse(e.data);
      setPublications(prev => {
        const next = [...prev];
        next[index] = { ...next[index], ...extra };
        return next;
      });
      setProgress({ completed, total });
    });

    es.addEventListener('error', (e) => {
      try {
        const { completed, total } = JSON.parse(e.data);
        setProgress({ completed, total });
      } catch {
        // connection-level error, no payload to parse
      }
    });

    es.addEventListener('done', () => {
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

    return () => es.close();
  }, [streamUrl]);

  return { publications, progress, done, failed };
}
