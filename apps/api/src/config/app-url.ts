/**
 * An absolute link into the web app: "/leads/abc" → "https://app.example.com/leads/abc".
 *
 * Used wherever the API writes a link a person will click outside the app — a webhook
 * payload, a chat message, a password-reset email. `WEB_APP_URL` is the deployed address;
 * without it the first CORS origin is the best guess, because that is where the browser
 * that talks to this API is served from.
 */
export function appUrl(path: string): string {
  const base =
    process.env.WEB_APP_URL?.trim() ||
    (process.env.API_CORS_ORIGINS ?? "").split(",")[0]?.trim() ||
    "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${path}`;
}
