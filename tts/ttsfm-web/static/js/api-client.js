const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

function shouldUseCache(entry) {
  if (!entry) {
    return false;
  }
  if (entry.expiresAt === null) {
    return true;
  }
  return Date.now() < entry.expiresAt;
}

async function fetchWithCache(url, { signal, refresh = false } = {}) {
  if (!refresh) {
    const cached = cache.get(url);
    if (shouldUseCache(cached)) {
      return cached.data;
    }
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }
  const data = await response.json();
  cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function clearCache(urlPrefix) {
  if (!urlPrefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(urlPrefix)) {
      cache.delete(key);
    }
  }
}

export function fetchVoices(options = {}) {
  return fetchWithCache('/api/voices', options);
}

export function fetchFormats(options = {}) {
  return fetchWithCache('/api/formats', options);
}

export function primeCache(url, data, ttlMs = CACHE_TTL_MS) {
  cache.set(url, { data, expiresAt: ttlMs === null ? null : Date.now() + ttlMs });
}
