# Life OS

A personal command center for tasks, projects, goals, calendar, health, money,
relationships, habits and time — built so that opening it *reduces* what you
have to hold in your head.

Two principles run through the whole codebase:

**It never invents precision.** There is no 0-100 "life score". Every derived
signal names the concrete inputs it used and publishes the rule that produced
it. Where data is missing, the app says so instead of estimating.

**Nothing surfaces without a reason attached.** Every warning explains why it
is on screen — "No activity for 19 days, and the deadline is in 74 days" — and
can be dismissed, snoozed, investigated, turned into a task, or handed to the AI.

---

## 1. What is built

| Area | State |
|---|---|
| Dashboard | Today's priorities (Must/Should/Could), Attention Required, Life Pulse, today's schedule with remaining free time, habits |
| Tasks | Full CRUD, URL-driven filters by view, time, energy and project, optimistic completion |
| Projects | List and detail, progress, next action, milestones, stall detection |
| Goals | Hierarchy, measured progress from a start value, progress vs. elapsed time |
| Calendar | Day / week / month, meeting, focus, fragmentation and free-time analytics |
| Life Areas | Create, rename, recolour, reorder, archive |
| Health | Sleep, RHR, HRV, steps, weight trends with sparklines; explicitly no medical inference |
| Fitness | Workouts, exercises, sets, personal records, 12-week frequency |
| Finances | Net worth, trailing savings rate, spending by category, anomaly detection |
| Relationships | Personal CRM with a user-set contact cadence, interactions, upcoming dates |
| Habits | Streaks, 30-day consistency, per-day grid |
| Journal | Mood/energy/productivity, wins, challenges, gratitude, searchable history |
| Notes | Typed notes, tags, search, linked to projects and areas |
| Analytics | Intended vs. actual time, completion trend, goal progress, health and money |
| Reviews | Weekly and monthly, deterministic stats + editable narrative |
| Chief of Staff | Tool-using AI over your own data, with citations and confirm-before-write |
| Notifications | Engine, centre, per-category preferences, quiet hours, push, deep links |
| Integrations | Full adapter framework; 17 providers defined, adapters not yet written |
| PWA | Installable, offline shell, push, generated icons |
| Global | Command palette, quick capture, global search, dark/light, mobile-first |

**Not built:** live integration adapters (framework only), semantic/vector
search (schema reserved), native app packaging (architecture supports it),
focus-session timer UI (model and analytics exist).

---

## 2. Architecture

```
                          Life OS API
                     (server actions + RSC)
                               │
        ┌──────────────────────┼──────────────────────┐
     Desktop web           Mobile PWA          Future native
        └──────────────────────┼──────────────────────┘
                               │
              ┌────────────────┴────────────────┐
         Domain layer                     Integration layer
    (pure, testable rules)            Provider → Adapter →
    pulse · attention · goals          Normalised record →
    projects · calendar · money         Life OS model
              └────────────────┬────────────────┘
                               │
                   Drizzle ORM → libSQL/SQLite
                               │
                       AI (tools over the domain)
```

Layering rules the code actually follows:

- **`src/lib/domain/*`** holds every derived rule (what "stalled" means, how
  progress is measured, when spending is anomalous). It is the single source of
  truth: the dashboard, the reviews and the AI all read the same functions, so
  they cannot disagree with each other.
- **`src/lib/actions/*`** are the only writers. Each re-checks ownership
  server-side rather than trusting an id from the client.
- **UI never imports a provider.** Adapters normalise to a shared record shape;
  nothing above that layer knows where data came from.
- **The AI cannot write.** It reads through scoped tools and returns
  *proposals*; a write only happens when the user clicks confirm.

### Stack

Next.js 16 (App Router, RSC, server actions) · React 19 · TypeScript strict ·
Tailwind v4 with design tokens · Drizzle ORM · libSQL/SQLite · `jose` sessions ·
bcrypt · Anthropic SDK · `web-push` · Vitest.

SQLite was chosen because this is one person's data on one machine. Pointing
`DATABASE_URL` at a Turso/libSQL URL moves the same schema to a hosted database
with no code change, which is the path to real cross-device sync.

---

## 3. Database schema

32 tables. Highlights rather than an exhaustive list:

**Core** `users` · `user_settings` · `devices` · `life_areas` · `goals` ·
`projects` · `milestones` · `tasks` · `events`

**Life** `people` · `interactions` · `habits` · `habit_entries` ·
`journal_entries` · `notes` · `metrics` · `workouts` · `exercises` ·
`exercise_sets` · `financial_accounts` · `transactions`

**System** `reviews` · `integrations` · `sync_records` · `notifications` ·
`notification_preferences` · `ai_conversations` · `ai_messages` ·
`focus_sessions` · `signal_dismissals` · `time_budgets` · `audit_log`

Three conventions matter:

- **Data ownership.** Every user-facing row carries `origin` (`user` /
  `imported` / `ai`) plus an `is_demo` flag. AI-created rows are marked as such
  and never overwrite user-authored data.
- **Provenance.** Anything importable carries `provider`, `external_id`,
  `last_synced_at` and `source_meta`, with a unique index on
  `(provider, external_id)` so re-syncing updates instead of duplicating.
- **Soft deletion.** `deleted_at` everywhere it matters; reads filter it out,
  history keeps it.

---

## 4. Current integrations

None are live. The framework is complete and exercised by tests: normalised
record types, adapter contract, incremental sync cursors, sync history with
error reporting, and idempotent upsert by `(provider, external_id)`.

Credentials are never stored in this database — `integrations.credential_ref`
holds an opaque pointer to a server-side secret store, and nothing
credential-shaped is ever sent to the browser or included in an export.

## 5. Integrations the architecture supports

Google Calendar · Outlook Calendar · Apple Calendar · Todoist · Linear ·
Notion · Gmail · Slack · Apple Health · Oura · Garmin · Fitbit · Strava ·
Plaid · Google Drive · Dropbox · Spotify

Adding one is a single adapter file implementing `ProviderAdapter` plus a
registry entry. No schema migration, no UI change.

---

## 6. How to run it

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` creates `.env`, generates an auth secret, applies migrations,
generates icons, and seeds a demo account. Then open http://localhost:3000 and
sign in:

```
email:    demo@lifeos.local
password: demo-life-os-2026
```

The sample data is a complete, internally consistent example life with
deliberate signals in it — a stalled project, a neglected goal, a sleep dip, a
dining overspend, a friend past their contact cadence — so every feature has
something true to show. Every demo row is labelled and removable in one click
from Settings.

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm test` | 54 unit and integration tests |
| `npm run db:generate` / `db:migrate` | Create and apply migrations |
| `npm run db:seed` / `db:reset` | Reseed demo data / drop all tables |
| `npm run generate:secret` / `generate:vapid` | Auth and push keys |

---

## 7. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (defaults to a local file) | `file:./data/life-os.db` or a libSQL/Turso URL |
| `DATABASE_AUTH_TOKEN` | Hosted only | libSQL/Turso auth |
| `AUTH_SECRET` | **Yes** | Signs session cookies. `npm run generate:secret` |
| `ANTHROPIC_API_KEY` | No | Enables the reasoning Chief of Staff and review narratives |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No | Web push. `npm run generate:vapid` |
| `VAPID_PRIVATE_KEY` | No | Web push |
| `VAPID_SUBJECT` | No | Contact address for push |

Everything optional degrades honestly rather than breaking: with no API key the
Chief of Staff returns a labelled readout of your real data and reviews are
generated from the same numbers without narrative rewriting; with no VAPID keys
notifications stay in-app.

---

## 8. Known limitations

1. **No integration adapters.** The framework is real and tested; the
   per-provider code and OAuth credentials are not written.
2. **Notifications are generated on view, not by a scheduler.** Generation and
   delivery are idempotent and run when the notification centre or dashboard is
   loaded. Real background delivery needs a cron or queue calling
   `generateNotifications` and `deliverDueNotifications`.
3. **Morning and evening briefings are configurable but not dispatched** — same
   missing scheduler.
4. **Offline is read-mostly.** The service worker caches an app shell and
   visited pages; the offline write queue described in the UI is not
   implemented, so captures made offline are not yet replayed.
5. **Time analytics measure calendar events and timed focus sessions**, not
   every waking minute. The UI states this where the numbers appear.
6. **Search is `LIKE`-based.** Correct at personal-database scale; the return
   shape is designed so vector ranking can replace it without touching callers.
7. **Single-user by design.** The first account claims the instance and further
   signup is closed.
8. **Focus mode** has a data model and analytics but no timer UI.
9. **Weather is a placeholder slot** that says so rather than showing fake data.

---

## 9. Recommended next steps

1. **Google Calendar first.** It is the highest-value integration and it proves
   the adapter contract end to end, including incremental cursors and conflict
   handling.
2. **A scheduler.** A single cron hitting a protected route unlocks real push,
   morning/evening briefings and proactive AI in one move.
3. **Offline write queue.** Persist captures to IndexedDB and replay through the
   existing server actions on reconnect, with last-write-wins per field and no
   silent overwrite of newer data.
4. **Plaid, then a health provider.** These make Life Pulse's money and health
   models genuinely useful rather than demo-shaped.
5. **Focus timer UI** over the existing `focus_sessions` model, which would make
   intended-vs-actual time real rather than calendar-derived.
6. **Semantic search** — add an embedding column and rank inside `globalSearch`.
7. **Capacitor wrapper** once push and offline are solid; the API and domain
   layers are already independent of the web UI.

---

## Testing

```bash
npm test
```

54 tests. Unit tests cover the capture parser, goal and project progress, habit
streaks, calendar analytics and free slots, quiet-hours wraparound and date
helpers. Integration tests run against a migrated SQLite file and cover
provisioning idempotency, the task/project lifecycle, soft deletion, sync upsert
by `(provider, external_id)`, notification dedupe including not resurrecting a
dismissed notification, password hashing, session tampering, and demo
seed/clear.
