/**
 * Image Proxy URL normalizer
 */
export function toProxiedUrl(url: string | undefined | null, isLocal?: boolean): string {
  if (!url) return "";
  if (isLocal || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const clean = url.trim();
  if (clean.startsWith("/api/proxy-image") || clean.startsWith("api/proxy-image")) {
    return clean.startsWith("/") ? clean : `/${clean}`;
  }
  if (clean.startsWith("/api/")) return clean;
  return `/api/proxy-image?url=${encodeURIComponent(clean)}`;
}
