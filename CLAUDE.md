# Life OS — working notes

A personal Life OS. Read `README.md` first for what exists and how to run it.
This file is about how to work in the codebase without breaking its principles.

## Commands

```bash
npm run dev            # dev server
npm test               # vitest, 68 tests
npm run build          # production build — the real client/server boundary check
npm run db:generate    # after any schema change
npm run db:migrate
npm run db:seed        # reseed demo data (safe to re-run)
```

## The two rules that matter

**1. Never invent precision.** If a number cannot be computed honestly, return
`null` and let the UI say "no data" or "not connected yet". Do not default to
zero, estimate, or illustrate. `computeGoalProgress` returning `null` rather
than `0` is the pattern to copy.

**2. Every surfaced signal explains itself.** Anything that appears in
Attention, Life Pulse or a notification carries the reason it fired. If you add
a detector, add its threshold to the methodology text next to it.

Corollary: thresholds live in named constants (`STALL_THRESHOLD_DAYS`,
`NEGLECT_THRESHOLD_DAYS`) and are documented where the user can read them.

## Layout

```
src/db/           schema, migrations, seed. columns.ts holds shared column helpers
src/lib/domain/   derived rules. Pure where possible, always server-only
src/lib/actions/  every write. "use server". Re-check ownership, never trust ids
src/lib/ai/       Chief of Staff: tools, agent loop, deterministic fallback
src/lib/notifications/  engine (schedule/deliver) + generators (rules)
src/lib/integrations/   adapter contract and provider registry
src/components/   ui/ primitives, then one folder per feature area
```

## Client/server boundary — the trap to avoid

Domain modules import `server-only`. A **client component may only
`import type`** from them. Importing a *value* (a label map, a helper) compiles
fine under `tsc` and then fails at build with "server-only cannot be imported
from a Client Component".

Shared values live in modules with no database import:

- `src/lib/domain/labels.ts` — status and metric label maps
- `src/lib/domain/search-types.ts` — search and palette shapes

`npm run build` is the only reliable check for this. `tsc --noEmit` will not
catch it.

## Adding things

**A new derived signal**: put the rule in `src/lib/domain/`, expose it to the
AI as a tool in `src/lib/ai/tools.ts`, and add its threshold to the methodology
strings so the UI can explain it.

**A new integration**: implement `ProviderAdapter` from
`src/lib/integrations/types.ts`, add a `ProviderDefinition` to `registry.ts`,
and register it in `adapters.ts`. Touch nothing else — no schema change, no UI
change. `src/lib/integrations/providers/google-calendar.ts` is the worked
example; copy its shape.

Two rules the adapter layer enforces:

- **An adapter never touches the database.** It is handed credentials and a
  cursor and returns normalised records. That is what lets `sync.ts` own token
  refresh, upserts and bookkeeping once instead of once per provider.
- **Credentials live in `integration_credentials`, encrypted** with a key
  derived from `AUTH_SECRET` (`crypto.ts`). The `integrations` table holds only
  `credentialRef`. Reads are scoped by user id, so a leaked reference alone
  cannot retrieve a token.

**A new notification**: add a rule to `src/lib/notifications/generators.ts` with
a `dedupeKey` derived from the source row and the lead time. Generation must
stay idempotent — it runs on every page view.

**A schema change**: edit `schema.ts`, run `db:generate` then `db:migrate`.
Prefer soft deletion. Anything importable needs the `provenance` spread;
anything user-facing needs `ownership`.

## Goal shapes

A goal is one of three kinds, and they are not interchangeable:

- `target` — a climb. Progress is `(current - start) / (target - start)`.
- `floor` — a line to hold at or above (a GPA, a savings rate).
- `ceiling` — a limit to stay under (a resting heart rate, a monthly spend).

Three questions, and they are not the same one:

- `computeGoalProgress` — how much is done.
- `computeTimeElapsed` + `behindSchedule` — whether the clock has run further
  than the work. Answers "am I late".
- `computeGoalPace` — the rate needed from here against the rate achieved so
  far. Answers "can I still get there", which is the question progress cannot
  answer: a goal at 20% with 4% elapsed reads as comfortably ahead while being
  arithmetically out of reach, if the 20% was where it started.

`computeGoalPace` returns `actualPerWeek: null` until a goal is
`PACE_MINIMUM_DAYS` old. A rate from three days of history is invented
precision, and the null is what stops the UI printing one.

`computeCommitmentGap` is the version that works on day one: it compares the
linked habit's own target against the required rate, so a plan that cannot
succeed even when kept perfectly is called out while changing it is still cheap.
It needs no history because it measures the plan, not the delivery.

`computeGoalProgress` returns **null** for floors and ceilings on purpose.
A held line is not "100% complete" — it has to hold until the goal ends, and a
full progress bar tells the reader to stop watching at exactly the wrong
moment. Use `computeThresholdState` for those, and always show the elapsed
clock alongside it.

## Projects and goals are many-to-many

`projects.goalId` is the **primary** goal and drives life-area inheritance.
`project_goals` holds every additional goal the project contributes to. Both
are counted when working out whether a goal has anything moving it, deduped by
project id. Keep the primary out of the join table in the write path
(`setExtraGoals`) so the two can never disagree about which goal is the
headline one.

## The scheduler

`/api/cron/notifications` is the only thing that makes notifications arrive
without the app being open. It is protected by `CRON_SECRET` and refuses to
run at all if that is unset. Everything it calls is idempotent, so calling it
more often is safe and calling it twice is harmless.

Vercel Hobby allows one cron run a day, so the real cadence lives in
`.github/workflows/notifications.yml` (every 15 minutes). Deployment steps are
in `DEPLOY.md`.

## OAuth

`state` is a signed JWT carrying the user id, not a random value in a session.
The callback deliberately does **not** call `requireUser`: the owner comes from
the state, so an authorisation code can only ever attach to the account that
started the flow.

The redirect URI is built in one place (`redirect-uri.ts`) and preferred from
`APP_URL`, because it has to be byte-identical across the authorise request,
the token exchange and what is registered at the provider — and a hosting
platform's per-deployment hostname is none of those.

## Briefings

`briefings.ts` schedules rather than sends: the row is created with
`scheduledFor` set to the user's wall-clock time and the normal delivery pass
picks it up, so nothing in it needs to know the current time. It is given an
`expiresAt` three hours out, because a morning briefing delivered at two in the
afternoon is a stale interruption rather than a briefing.

All wall-clock reasoning goes through `src/lib/time-zone.ts`. Never use
`Date`'s local getters for anything a user sees a time for.

## Things that will bite you

- **The server's clock is not the user's clock.** Hosted, the runtime is UTC,
  so `getHours()` shifts quiet hours by the offset and `getDate()` rolls the
  day over at 19:00 Central — an evening habit lands on tomorrow. `register()`
  in `src/instrumentation.ts` sets `process.env.TZ` from `APP_TIMEZONE`
  (Vercel reserves `TZ` itself), which is sound only because this is
  single-user. `inQuietHours` takes an explicit zone regardless, and is the
  pattern to follow if the domain layer ever needs to serve two clocks.

- **A category's push switch silently overrides a feature's own switch.**
  Briefings live in the System category, so "Morning briefing: on" plus System
  push off means nothing ever arrives. Any new feature with its own enable flag
  needs to check the category it will be delivered under, and say so in the UI.

- **`orderBy` on events.list suppresses Google's sync token.** The request
  returns 200 with the right events and no `nextSyncToken`, so the cursor is
  never stored and every run is a full re-read for ever. Nothing errors. The
  params are built in `buildEventsParams` and tested, because this is invisible
  from the outside — the only symptom is `mode: "full"` in the sync history.

- **Google's all-day end date is exclusive.** An event on the 14th arrives as
  start 14th, end 15th. Stored literally it spans two days everywhere in the
  app. `normaliseGoogleEvent` pulls it back by a millisecond.

- **Grid overflow on mobile.** Grid items default to `min-width: auto`. Every
  responsive grid needs an explicit `grid-cols-[minmax(0,1fr)]` base track or
  it will force the layout wider than a phone viewport.
- **Trailing windows, not calendar months.** Month-to-date reports "no income"
  for anyone paid at the end of the month. Use `getCashflowForRange`.
- **Anomaly detection needs a noise floor.** A percentage over a mean flags
  half your categories. Require exceeding the prior *peak* too.
- **Turbopack dev caching goes stale** after edits that move module-level
  constants. If dev shows an error the build does not, `rm -rf .next`.
- **`Suspense` with `fallback={null}`** around a client component on a
  `force-dynamic` page can render a blank screen if the boundary never flushes.

## AI conventions

The Chief of Staff reads through tools scoped to one `userId`, bound at call
time and never present in any tool schema. Write tools return **proposals**;
`confirmProposal` is the only path to a write, and it stamps `origin: "ai"` and
an audit row. Reviews compute every number in `buildReviewStats` — the model
only rewrites prose and is told it may not change a figure.
