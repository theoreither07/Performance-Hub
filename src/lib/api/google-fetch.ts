/**
 * Schlanker Google-API-Wrapper — ersetzt das ~3 MB grosse `googleapis`-Paket
 * durch direkte fetch()-Calls. Spart Bundle-Size + Build-Zeit signifikant.
 *
 * Coverage:
 *  - OAuth2 Token-Refresh (Refresh-Token → Access-Token)
 *  - Google Calendar API v3 (list events, insert, delete, calendarList)
 *  - Gmail API v1 (messages list, get, modify)
 *
 * Auth-Modell: jede Funktion bekommt entweder ein `accessToken` direkt oder
 * den `refreshToken` aus DB — wir hashen Tokens nicht intern, refreshen on-demand.
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

/**
 * Holt einen frischen Access-Token via OAuth2 Refresh-Flow.
 * Cached intern den letzten Token + Expiry pro Refresh-Token (Memo-Lebensdauer = einzelne Request).
 */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET nicht gesetzt");

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OAuth refresh failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as TokenRefreshResponse;
  return data.access_token;
}

interface GoogleFetchInit {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
}

function buildQuery(q: GoogleFetchInit["query"]): string {
  if (!q) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

async function googleFetch<T = unknown>(
  base: string,
  path: string,
  accessToken: string,
  init: GoogleFetchInit = {},
): Promise<T> {
  const url = `${base}${path}${buildQuery(init.query)}`;
  // 8s Timeout — Google API kann gelegentlich haengen (ETIMEDOUT). Ohne Timeout blockiert
  // sich z.B. Business-Account-Calendar-Fetch und der ganze Endpoint wartet ewig.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Google API ${res.status}: ${body.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  // DELETE liefert 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ============================================================================
// Calendar API
// ============================================================================

export interface CalendarListItem {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
}

export interface CalendarEventApi {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  colorId?: string;
  reminders?: { useDefault?: boolean; overrides?: Array<{ method: string; minutes: number }> };
  recurringEventId?: string;
  recurrence?: string[];
}

export interface EventInsertBody {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  colorId?: string;
  reminders?: { useDefault?: boolean };
}

export async function calendarList(accessToken: string, maxResults = 250): Promise<{ items?: CalendarListItem[] }> {
  return googleFetch(CALENDAR_BASE, "/users/me/calendarList", accessToken, {
    query: { maxResults },
  });
}

export async function calendarEventsList(
  accessToken: string,
  calendarId: string,
  opts: {
    timeMin?: string;
    timeMax?: string;
    singleEvents?: boolean;
    orderBy?: "startTime" | "updated";
    maxResults?: number;
    privateExtendedProperty?: string | string[];
  } = {},
): Promise<{ items?: CalendarEventApi[] }> {
  return googleFetch(CALENDAR_BASE, `/calendars/${encodeURIComponent(calendarId)}/events`, accessToken, {
    query: opts,
  });
}

export async function calendarEventInsert(
  accessToken: string,
  calendarId: string,
  body: EventInsertBody,
): Promise<CalendarEventApi> {
  return googleFetch(CALENDAR_BASE, `/calendars/${encodeURIComponent(calendarId)}/events`, accessToken, {
    method: "POST",
    body,
  });
}

export async function calendarEventDelete(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await googleFetch(CALENDAR_BASE, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, accessToken, {
    method: "DELETE",
  });
}

// ============================================================================
// Gmail API
// ============================================================================

export interface GmailMessageRef { id: string; threadId: string; }
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
  internalDate?: string;
}

export async function gmailMessagesList(
  accessToken: string,
  opts: { q?: string; maxResults?: number; labelIds?: string[]; pageToken?: string } = {},
): Promise<{ messages?: GmailMessageRef[]; resultSizeEstimate?: number; nextPageToken?: string }> {
  return googleFetch(GMAIL_BASE, "/users/me/messages", accessToken, { query: opts });
}

export async function gmailMessageGet(
  accessToken: string,
  id: string,
  format: "minimal" | "metadata" | "full" = "metadata",
): Promise<GmailMessage> {
  return googleFetch(GMAIL_BASE, `/users/me/messages/${id}`, accessToken, {
    query: { format },
  });
}

export async function gmailUserProfile(accessToken: string): Promise<{ emailAddress: string }> {
  return googleFetch(GMAIL_BASE, "/users/me/profile", accessToken);
}

export async function gmailLabelGet(
  accessToken: string,
  labelId: string,
): Promise<{ id: string; name: string; messagesUnread?: number; messagesTotal?: number }> {
  return googleFetch(GMAIL_BASE, `/users/me/labels/${labelId}`, accessToken);
}

// ============================================================================
// OAuth helper — replaces google.auth.OAuth2 + generateAuthUrl
// ============================================================================

export function buildOAuthAuthUrl(params: {
  scope: string[];
  state?: string;
  loginHint?: string;
  redirectUri: string;
  prompt?: "none" | "consent" | "select_account";
  accessType?: "online" | "offline";
}): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID nicht gesetzt");
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: params.scope.join(" "),
    access_type: params.accessType ?? "offline",
    prompt: params.prompt ?? "consent",
    include_granted_scopes: "false",
  });
  if (params.state) qs.set("state", params.state);
  if (params.loginHint) qs.set("login_hint", params.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string; refresh_token?: string; scope?: string; id_token?: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET nicht gesetzt");
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OAuth code exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}
