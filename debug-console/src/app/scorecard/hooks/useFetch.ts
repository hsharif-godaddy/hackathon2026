'use client';

import { useEffect, useRef, useState } from 'react';

export function useFetch<T>(
  queryString: string | null,
): { data: T | null; loading: boolean; stale: boolean; error: string | null } {
  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale]     = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const abortRef              = useRef<AbortController | null>(null);

  useEffect(() => {
    if (queryString === null) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Defer one macrotask so React StrictMode's synchronous cleanup (which
    // calls ctrl.abort() + clearTimeout) fires before the network request
    // starts — prevents the first-mount batch showing as "(cancelled)" in DevTools.
    const timerId = setTimeout(() => {
      setStale((prev) => { if (!prev) setStale(true); return true; });
      setLoading(true);
      setError(null);

      fetch(`/api/analytics/scorecard?${queryString}`, { signal: ctrl.signal })
        .then((r) => {
          if (!r.ok) return r.json().then((e: unknown) => Promise.reject(new Error((e as { error?: string }).error ?? r.statusText)));
          return r.json() as Promise<T>;
        })
        .then((d) => { setData(d); setLoading(false); setStale(false); })
        .catch((e: unknown) => {
          if ((e as { name?: string }).name === 'AbortError') { setLoading(false); return; }
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false); setStale(false);
        });
    }, 0);

    return () => { clearTimeout(timerId); ctrl.abort(); };
  }, [queryString]);

  return { data, loading, stale, error };
}
