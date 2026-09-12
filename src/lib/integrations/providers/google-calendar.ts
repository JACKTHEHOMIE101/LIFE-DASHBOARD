import type { NormalisedRecord, ProviderAdapter, SyncContext, SyncResult } from "../types";
import { PROVIDERS } from "../registry";

/**
 * Google Calendar.
 *
 * The reference implementation of `ProviderAdapter`: it exercises every part of
 * the contract — a redirect OAuth flow, refreshable credentials, incremental
 * sync by cursor, deletions, and revocation.
 *
 * Two decisions worth knowing about:
 *
 * `singleEvents=true` asks Google to expand recurring events into individual
 * occurrences. Without it a weekly study hall arrives as one row with a
 * recurrence rule, and every part of Life OS that reads the calendar — today's
 * schedule, free time, meeting load — would have to learn to expand RRULEs.
 * Expanding at the boundary keeps that complexity in one place.
 *
 * The cursor is a map of calendar id to sync token rather than a single token,
 * because Google issues one per calendar. A single string would mean either
 * syncing one calendar or re-reading all of them every time.
 */

const OAUTH_AUTHORISE = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

/** How far back the first sync reaches. Older events are history, not schedule. */
const INITIAL_WINDOW_DAYS = 30;

/** Google's page size cap for events.list. */
const PAGE_SIZE = 250;

/**
 * A ceiling on pages per calendar per run.
 *
 * A first sync of a busy decade-old calendar could otherwise loop for minutes
 * and hit the serverless timeout, leaving no cursor and no progress. Stopping
 * early is safe: without a sync token the next run resumes from the same
 * window, and the partial page token is not persisted.
 */
const MAX_PAGES = 20;

const definition = PROVIDERS.find((p) => p.id === "google_calendar")!;

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { displayName?: string; email?: string; self?: boolean }[];
  recurringEventId?: string;
};

type Cursor = Record<string, string>;

function parseCursor(raw: string | null): Cursor {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Cursor) : {};
  } catch {
    // A cursor we cannot read is not an error worth failing a sync over: the
    // worst case is one full re-read, and upserts make that harmless.
    return {};
  }
}

/* ----------------------------------------------------------------- tokens */

function credentialsOrThrow(context: SyncContext) {
  const accessToken = context.credentials.accessToken;
  if (!accessToken) throw new Error("This Google Calendar connection has no access token.");
  return context.credentials;
}

/**
 * Exchanges a refresh token for a new access token.
 *
 * Exported because the sync runner has to persist the result: an adapter is
 * given credentials and cannot store them itself, by design.
 */
export async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured on the server.");

  const response = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    // A revoked or expired refresh token is permanent and needs the user, so
    // say which it is rather than letting it read as a transient failure.
    if (response.status === 400 || response.status === 401) {
      throw new Error("Google has revoked this connection. Reconnect it to continue syncing.");
    }
    throw new Error(`Google refused to refresh the token (${response.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: data.access_token,
    expiresAt: String(Date.now() + (data.expires_in ?? 3600) * 1000),
  };
}

/** True when the stored access token is expired or close enough to it to matter. */
export function accessTokenExpired(credentials: Record<string, string>) {
  const expiresAt = Number(credentials.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  // A minute of margin, so a token does not expire midway through a sync.
  return Date.now() > expiresAt - 60_000;
}

/* ------------------------------------------------------------------ fetch */

async function googleGet(path: string, params: URLSearchParams, accessToken: string) {
  const response = await fetch(`${API}${path}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 410) {
    // Google's way of saying the sync token is too old to be useful.
    const error = new Error("SYNC_TOKEN_EXPIRED");
    error.name = "SyncTokenExpired";
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Calendar returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return response.json();
}

/**
 * Query parameters for one events.list page.
 *
 * Extracted and exported so the sync-token rules can be tested without a Google
 * account, because getting them wrong fails silently: the request succeeds, the
 * events are correct, and the only symptom is that every run is a full re-read
 * for ever.
 *
 * Two rules, both learned the hard way:
 *
 * `orderBy` suppresses `nextSyncToken` entirely. Google returns 200 and the
 * right events, just no token, so the cursor is never stored. Ordering is
 * worthless here anyway — every record is upserted by external id.
 *
 * A sync token cannot be combined with a time window; Google rejects it. So the
 * first request carries `timeMin` and no token, and every later one carries the
 * token and no window.
 */
export function buildEventsParams({
  syncToken,
  pageToken,
  now = new Date(),
}: {
  syncToken: string | null;
  pageToken?: string;
  now?: Date;
}) {
  const params = new URLSearchParams({
    singleEvents: "true",
    maxResults: String(PAGE_SIZE),
    showDeleted: "true",
  });

  if (syncToken) {
    params.set("syncToken", syncToken);
  } else {
    const from = new Date(now);
    from.setDate(from.getDate() - INITIAL_WINDOW_DAYS);
    params.set("timeMin", from.toISOString());
  }

  if (pageToken) params.set("pageToken", pageToken);
  return params;
}

/* ------------------------------------------------------------ normalising */

export function normaliseGoogleEvent(
  event: GoogleEvent,
  calendarId: string,
  calendarName: string,
): NormalisedRecord | null {
  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  // An event with no times is not something the calendar can place. Skipping it
  // is honest; inventing a time would put a fiction on the schedule.
  if (!startRaw || !endRaw) return null;

  const allDay = Boolean(event.start?.date);
  const startsAt = new Date(startRaw);
  // Google's all-day end date is exclusive: a one-day event ends the next
  // morning. Left alone it would render as spanning two days.
  const endsAt = allDay ? new Date(new Date(endRaw).getTime() - 1) : new Date(endRaw);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;

  return {
    kind: "event",
    externalId: event.id,
    title: event.summary?.trim() || "(no title)",
    startsAt,
    endsAt,
    allDay,
    location: event.location,
    description: event.description,
    attendees: (event.attendees ?? [])
      .filter((a) => !a.self)
      .map((a) => ({ name: a.displayName, email: a.email })),
    calendarId,
    calendarName,
  };
}

/* ----------------------------------------------------------------- adapter */

export const googleCalendarAdapter: ProviderAdapter = {
  definition,

  async beginConnect(_userId: string, redirectUri: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set on the server.");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: definition.scopes.join(" "),
      // Without offline access Google issues no refresh token, and the
      // connection dies silently an hour later.
      access_type: "offline",
      // Google only returns a refresh token on first consent. Forcing the
      // prompt means reconnecting after a problem actually fixes it.
      prompt: "consent",
      include_granted_scopes: "true",
    });

    return `${OAUTH_AUTHORISE}?${params}`;
  },

  async completeConnect(_userId: string, params: Record<string, string>) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured on the server.");
    if (!params.code) throw new Error("Google did not return an authorisation code.");

    const response = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: params.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google refused the authorisation code: ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!data.refresh_token) {
      // Without this the connection works for an hour and then stops, which is
      // far more confusing than refusing to connect now.
      throw new Error(
        "Google did not return a refresh token. Remove Life OS at " +
          "myaccount.google.com/permissions and connect again.",
      );
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: String(Date.now() + (data.expires_in ?? 3600) * 1000),
      scope: data.scope ?? definition.scopes.join(" "),
    };
  },

  async sync(context: SyncContext): Promise<SyncResult> {
    const { accessToken } = credentialsOrThrow(context);
    const cursor = parseCursor(context.cursor);

    const calendarList = (await googleGet(
      "/users/me/calendarList",
      new URLSearchParams({ minAccessRole: "reader", maxResults: "250" }),
      accessToken,
    )) as { items?: { id: string; summary?: string; selected?: boolean; primary?: boolean }[] };

    // Calendars the user has hidden in Google are hidden for a reason; the
    // primary calendar is always included even if the flag is absent.
    const calendars = (calendarList.items ?? []).filter(
      (c) => c.primary === true || c.selected !== false,
    );

    const records: NormalisedRecord[] = [];
    const deletedExternalIds: string[] = [];
    const nextCursor: Cursor = {};

    for (const calendar of calendars) {
      const calendarName = calendar.summary ?? calendar.id;
      let syncToken: string | null = cursor[calendar.id] ?? null;
      let pageToken: string | undefined;
      let pages = 0;

      // One retry, for the case where the stored token has aged out and the
      // whole calendar has to be re-read from scratch.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          do {
            const params = buildEventsParams({ syncToken, pageToken });

            const page = (await googleGet(
              `/calendars/${encodeURIComponent(calendar.id)}/events`,
              params,
              accessToken,
            )) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };

            for (const event of page.items ?? []) {
              if (event.status === "cancelled") {
                deletedExternalIds.push(event.id);
                continue;
              }
              const record = normaliseGoogleEvent(event, calendar.id, calendarName);
              if (record) records.push(record);
            }

            pageToken = page.nextPageToken;
            if (page.nextSyncToken) nextCursor[calendar.id] = page.nextSyncToken;
            pages++;
          } while (pageToken && pages < MAX_PAGES);

          break;
        } catch (error) {
          if (error instanceof Error && error.name === "SyncTokenExpired" && attempt === 0) {
            // Start this calendar again without a token: a full re-read, which
            // upserts make idempotent.
            syncToken = null;
            pageToken = undefined;
            pages = 0;
            continue;
          }
          throw error;
        }
      }
    }

    return {
      records,
      cursor: Object.keys(nextCursor).length > 0 ? JSON.stringify(nextCursor) : null,
      deletedExternalIds,
    };
  },

  async revoke(credentials: Record<string, string>) {
    const token = credentials.refreshToken ?? credentials.accessToken;
    if (!token) return;

    // Best effort. If Google refuses, the local rows still go: leaving a
    // connection the user asked to remove would be worse than an orphaned
    // grant they can clear from their Google account.
    await fetch(OAUTH_REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }).catch(() => undefined);
  },
};
