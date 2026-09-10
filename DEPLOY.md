# Deploying Life OS

Getting it off your laptop and onto your phone. Roughly 20 minutes, free.

The only reason this is needed: a server on `localhost` is reachable from your
laptop and nothing else. Notifications that reach your phone need a real URL
that exists when the laptop is shut.

---

## 1. The database (Turso)

The app already runs on libSQL, so this is a URL swap, not a migration.

```bash
npm i -g @tursodatabase/cli
turso auth signup
turso db create life-os
turso db show life-os --url          # -> DATABASE_URL
turso db tokens create life-os       # -> DATABASE_AUTH_TOKEN
```

Apply the schema to it:

```bash
DATABASE_URL="<url>" DATABASE_AUTH_TOKEN="<token>" npm run db:migrate
```

Then move your existing data across, ids and all:

```bash
TARGET_DATABASE_URL="<url>" TARGET_DATABASE_AUTH_TOKEN="<token>" npm run db:transfer
```

It copies parents before children so every foreign key holds, preserves ids so
all relationships survive, verifies row counts table by table afterwards, and
refuses to write over a target that already holds data unless you pass
`TRANSFER_OVERWRITE=1`. Your local database is never modified.

---

## 2. The app (Vercel)

```bash
npm i -g vercel
vercel                               # links the repo, first deploy
```

Then set the environment variables — Vercel dashboard, or:

```bash
vercel env add DATABASE_URL production
vercel env add DATABASE_AUTH_TOKEN production
vercel env add AUTH_SECRET production
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production
vercel env add VAPID_PRIVATE_KEY production
vercel env add VAPID_SUBJECT production
vercel env add CRON_SECRET production
vercel env add APP_TIMEZONE production        # e.g. America/Chicago
vercel env add ANTHROPIC_API_KEY production   # optional
```

`APP_TIMEZONE` is not optional in practice. A hosted server runs in UTC, and
without it quiet hours are judged on the wrong clock — the symptom is silence
all evening and alerts before dawn. Vercel reserves the name `TZ`, which is why
this uses its own. Check it with the `clocks` and `server` fields the cron
endpoint returns; they should read the time on your own wall.

Copy the values from your local `.env`. Keep `AUTH_SECRET` and the VAPID keys
the same as local if you want existing sessions and subscriptions to survive;
otherwise generate new ones.

```bash
vercel --prod
```

---

## 3. The scheduler

Notifications are generated and delivered by `/api/cron/notifications`. It does
nothing without a caller.

Vercel's Hobby plan allows **one cron run per day**, which is useless for
reminders, so `vercel.json` keeps a daily run as a backstop and the real
schedule lives in GitHub Actions — `.github/workflows/notifications.yml`, every
fifteen minutes, free.

Add two repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `APP_URL` | `https://your-app.vercel.app` — no trailing slash |
| `CRON_SECRET` | the same value you set in Vercel |

Then run it once by hand from the Actions tab to check it works. A healthy run
returns something like:

```json
{ "ok": true, "users": 1, "created": 3, "delivered": 1, "suppressedByQuietHours": 0 }
```

Two caveats worth knowing: GitHub can delay scheduled workflows by a few
minutes when busy, and it disables schedules on repositories with no activity
for 60 days. If notifications go quiet, check there first.

---

## 4. Your iPhone

**This part is not optional.** iOS does not deliver web push to a site open in
Safari. It only sends notifications to an app added to the Home Screen.

1. Open the Vercel URL in **Safari** — Chrome on iOS cannot do this.
2. Share button → **Add to Home Screen**.
3. Open Life OS from the new icon.
4. Go to **Settings → Devices** and tap **Enable on this device**.
5. Accept the iOS permission prompt.

The Devices page detects an iPhone that has not installed yet and shows these
steps, so you should not have to come back here.

Requires iOS 16.4 or later.

---

## Checking it actually works

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/notifications
```

- `401` — the secret does not match.
- `503` — `CRON_SECRET` is not set in Vercel.
- `{"ok":true,...}` with `delivered: 0` — nothing was due, which is normal. Set
  a task due in the next hour and run it again.

If a run reports `delivered` above zero and nothing reaches your phone, the
cause is almost always one of: the PWA is not installed, notification
permission was declined, or you are inside quiet hours (22:00–07:00 by
default, changeable in Settings → Notifications).
