/**
 * Returns the base URL for all API calls.
 *
 * Priority:
 *  1. VITE_API_URL  — set this in Vercel (or any host) env vars when the API
 *                     server lives on a different domain, e.g.:
 *                     https://your-api.railway.app
 *  2. import.meta.env.BASE_URL — Vite's built-in base, works on Replit where
 *                                BASE_PATH is injected at dev/build time.
 *  3. "/"           — safe fallback for local builds.
 *
 * The returned string always ends with "/".
 */
export function getApiBase(): string {
  const explicit = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/?$/, "/");
  return import.meta.env.BASE_URL ?? "/";
}
