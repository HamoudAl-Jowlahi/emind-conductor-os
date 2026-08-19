# How to use eMind Conductor OS

A practical guide: what you're looking at, which numbers are real, and how to
make them yours.

---

## 1. Everything you see right now is seeded demo data

The 63,450 followers, the 42,000 on Instagram, the client funnel, the finances
— **none of it is real**. It ships that way on purpose so every screen is alive
before you configure anything.

The system is built never to lie about this. Look at the top of the home page:

```
G-Brain offline · 21 connectors down · 15/30 agents live
SYSTEMS  0 / 21 connected
```

**That `0 / 21` is your honesty meter.** Nothing is connected, so every number
on screen is seed data. As you connect real services that counter climbs, and
the corresponding panels switch to live values. A connector is only ever
`connected`, `not_configured`, or `error` — it will never show a green light it
hasn't earned.

**Rule of thumb:** if `/integrations` says a service is not connected, any
number that would come from it is decoration.

---

## 2. Connect your first real service

Two ways. Both write to the same place: `.env.local`, which is gitignored and
never committed.

### Option A — from the UI (easiest)

1. Go to **`/integrations`**
2. Find the service, click **+ CONNECT**
3. Paste the key, click Save

The key takes effect **immediately, without restarting the server** — the
credential layer re-reads `.env.local` on every call. The tile flips to its real
status on refresh. Values are stored and never echoed back; the board only ever
shows `set` / `not set`.

Some tiles show **SETUP** instead of a form. Those need something the app can't
do for you (an IMAP app-password, macOS Full Disk Access, a CalDAV URL) — the
tile tells you exactly what.

### Option B — edit the file

```bash
cp .env.example .env.local
```

Fill in what you have and restart. `.env.example` documents every one of the 30+
supported keys with a comment on where to get it.

### Where to start

| Want | Key | Notes |
| --- | --- | --- |
| **Agent chat to work at all** | `AI_GATEWAY_API_KEY` | Vercel AI Gateway. Without it, chat reports "not configured". **Start here.** |
| Real email counts in `/comms` | `INBOX_1_HOST/_USER/_PASS` | Gmail needs an App Password, not your login password |
| Real revenue in `/finances` | `STRIPE_SECRET_KEY` | Fully implemented (balance + recent charges) |
| Real Slack in `/comms` | `SLACK_BOT_TOKEN` | Scopes: `channels:read`, `channels:history`, `users:read` |
| Real CRM in `/funnel` | `ATTIO_API_KEY` | |
| Docs in the knowledge layer | `NOTION_API_KEY` | Share the target pages with the integration |

---

## 3. Run and talk to the agents

### Run an agent

Go to **`/agents`** and hit **Run** on any row. What happens is real work, not a
simulation: the agent calls its connector, and the result is written to the
`agent_runs` table with a timestamp.

An agent without credentials fails **honestly and usefully**:

```
Gmail Worker → "No inboxes configured — set INBOX_1..4_HOST/_USER/_PASS in .env.local"
```

That failure *is* the feature. It tells you the exact next step. Rows marked
`no creds` are waiting on a key.

### Chat with an agent

Requires `AI_GATEWAY_API_KEY`. Each agent gets a system prompt describing its
job plus a set of read-only tools, so it can look things up mid-conversation
and answer from live data.

**Agents are strictly read-only.** They are instructed never to claim they sent,
created, scheduled, or published anything. They look and report; they do not
act. That's a deliberate safety boundary in v1, not an oversight.

### The Conductor

`/org` has a **broadcast composer**. One message goes to all 30 agents in
parallel and every reply is persisted. Useful as a morning standup: "what's your
status?" returns 30 honest answers at once.

---

## 4. Replace the seeded content with your own

All seeded content lives in **one file**: `lib/seed.ts`.

```bash
# 1. edit lib/seed.ts — your departments, agents, roadmap, accounts
# 2. re-seed (idempotent, INSERT OR REPLACE — updates rows, destroys nothing)
npm run seed
```

To start completely clean instead:

```bash
rm data/founder-os.db && npm run seed
```

The database rebuilds from `lib/seed.ts` on the next page load.

**If you add a new kind of data**, the project's architecture rule requires four
things together — a repository method, a Zod schema, a seed entry, and a test.
Don't query SQLite directly from a page or a route; that rule is what keeps live
sources swappable.

---

## 5. A realistic daily loop

1. **`/`** — one glance: what's connected, what's live, what ran
2. **`/comms`** — the unified inbox across email, Slack, WhatsApp
3. **`/agents`** — run the ones that matter, read their summaries
4. **`/funnel`** — where each client actually is
5. **`/brain`** — ask the knowledge core instead of hunting through notes

---

## 6. Honest limits of v1

Know these before you rely on it:

- **No authentication whatsoever.** Anyone who can reach port 4100 has full
  control. Keep it on localhost or a trusted private network. Never expose it.
- **Single operator.** No accounts, no roles, no multi-user isolation.
- **Agents cannot write** to external systems (see §3).
- **Runs are synchronous** — a long job can outlive its HTTP request.
- **SQLite, single writer** — right for one person, wrong for a shared product.

---

## 7. Commands

```bash
npm run dev        # http://localhost:4100
npm test           # 879 tests — must stay green
npm run typecheck  # tsc --noEmit
npm run seed       # re-seed (idempotent)
npm run build && npm start
```

Two things worth knowing about this environment:

- On **Node 24+**, `better-sqlite3` must be `^13` — earlier majors have no
  prebuilt binary and fall back to a source build that needs a C++ toolchain.
- **Never run `npm audit fix --force`.** It force-upgrades majors; it is what
  jumped this project from Next 14 to Next 16 and silently broke every dynamic
  route.

---

## 8. Themes

Seven colorways, picked from the palette icon in the top bar. Default is
**eMind** — Monolith black with the brand violet `#7c5cff`.

The governing rule: **violet means identity, never state.** Green/amber/red are
reserved for `ok`/`warn`/`err`. If you extend the UI, keep that separation —
it's what makes a glance at the home page trustworthy.
