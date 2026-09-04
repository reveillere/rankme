const TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Best-effort client-side cache for author search results, so retyping or
// switching back and forth between a query doesn't re-hit the network.
export function getCachedSearch(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return undefined;
        const { value, expiresAt } = JSON.parse(raw);
        if (Date.now() > expiresAt) {
            localStorage.removeItem(key);
            return undefined;
        }
        return value;
    } catch {
        return undefined;
    }
}

export function setCachedSearch(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + TTL_MS }));
    } catch {
        // storage full/unavailable — cache is best-effort, ignore
    }
}
