# Software Requirements Specification (SRS)
## FOUNDER OS — Personal Operating System & AI Agent Command Center

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Date | 2026-08-14 |
| Product version | 1.0.0 (`package.json`) |
| Status | As-built specification (reverse-engineered from the running system) |
| Standard | IEEE 830-1998 (adapted) |
| Verification basis | 869 automated tests across 98 files, all passing; `tsc --noEmit` clean; all 16 routes returning HTTP 200 |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [System Architecture](#3-system-architecture)
4. [Functional Requirements](#4-functional-requirements)
5. [External Interface Requirements](#5-external-interface-requirements)
6. [Data Requirements](#6-data-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Design Constraints & Governing Principles](#8-design-constraints--governing-principles)
9. [Assumptions and Dependencies](#9-assumptions-and-dependencies)
10. [Explicitly Out of Scope](#10-explicitly-out-of-scope)
11. [Verification & Acceptance](#11-verification--acceptance)
12. [Appendix A — Glossary](#appendix-a--glossary)
13. [Appendix B — Known Gaps & Technical Debt](#appendix-b--known-gaps--technical-debt)

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements of **Founder OS**, a
single-operator web application that consolidates the operation of a one-person business into a
single command center. It is written as an **as-built** specification: every requirement below
reflects behaviour present in the current codebase and covered by the automated test suite, unless
explicitly marked `[PLANNED]`.

The intended audience is: engineers extending the system, reviewers assessing its fitness for a new
product direction, and any party evaluating the codebase as a foundation for derivative work.

### 1.2 Scope

Founder OS provides:

- A unified operator console aggregating communications, client funnel, social growth, finances,
  content, and workflows.
- A roster of **30 named AI agents** organised into 6 departments, each mapped 1:1 to an executable
  runtime implementation.
- A **connector layer** of 21 external-service integrations that report their real state and never
  fabricate a "connected" status.
- A **knowledge layer** (G-Brain) providing a single shared memory across all agents.
- A local, self-seeding **SQLite** persistence layer with schema validation at every boundary.

Founder OS **does not** provide: end-customer-facing surfaces, authentication, multi-tenancy,
order/commerce processing, or autonomous write actions. See §10.

### 1.3 Definitions

See [Appendix A](#appendix-a--glossary).

### 1.4 References

| Ref | Document |
| --- | --- |
| R1 | `CLAUDE.md` — project engineering contract |
| R2 | `README.md` — public product description |
| R3 | `.env.example` — full credential surface |
| R4 | `tests/` — 98 executable specification files |

---

## 2. Overall Description

### 2.1 Product Perspective

Founder OS is a **self-contained, locally-hosted web application**. It is not a SaaS product and has
no server-side multi-user model. It runs on the operator's own machine (or a dedicated private
host), binds to port **4100**, and reads its credentials from the operator's own filesystem.

It sits *above* the operator's existing tool stack rather than replacing it: Slack, Gmail, Stripe,
Notion, Attio, and 16 other services remain the systems of record. Founder OS aggregates, reports
on, and acts against them.

### 2.2 Product Functions (summary)

| # | Function | Route |
| --- | --- | --- |
| F1 | Operator console — system pulse, connection health, agent roster, knowledge core | `/` |
| F2 | Unified communications feed across email, Slack, WhatsApp, dictation | `/comms` |
| F3 | Client-journey funnel visualisation (linear + radial) | `/funnel` |
| F4 | Workflow map and automation statistics | `/workflows` |
| F5 | Social growth dashboard (6 platforms) | `/social` |
| F6 | Content pipeline and publishing calendar | `/content` |
| F7 | Financial reporting — income, expenses, statements, bank ingestion | `/finances` |
| F8 | Agent roster with execution controls and run history | `/agents` |
| F9 | Agent-generated task board | `/tasks` |
| F10 | Reusable, schedulable agent skills catalogue | `/skills` |
| F11 | Organisational hierarchy and broadcast composer | `/org` |
| F12 | G-Brain knowledge core, graph, and query interface | `/brain` |
| F13 | Live connections board and credential management | `/integrations` |
| F14 | Roadmap by phase and quarter | `/roadmap` |
| F15 | Cross-connector analytics | `/analytics` |
| F16 | Reference model documentation | `/reference` |
| F17 | Persona templates (alternate platform configurations) | `/personas` |

### 2.3 User Classes

| Class | Description | Count |
| --- | --- | --- |
| **Operator** | The single business owner. Full, unrestricted access to every function. The only human user class. | 1 |
| **Agent** | Non-human actor. Executes a scoped job, reports a result, persists a run record. | 30 |
| **Conductor** | Super-agent. Fans a single instruction out to the full roster and aggregates replies. | 1 |

> **Note:** There is no *customer*, *client*, or *guest* user class. Clients appear in the system as
> **data** (funnel contacts, CRM records), never as authenticated actors.

### 2.4 Operating Environment

| Component | Requirement |
| --- | --- |
| Runtime | Node.js 18+ (verified on Node 26 with `better-sqlite3@13`) |
| OS | Cross-platform (macOS-first; verified on Windows 11) |
| Browser | Any modern evergreen browser |
| Network | Optional — the application is fully functional offline against seeded data |
| Port | 4100 (fixed; 4000 is reserved by a sibling application) |

---

## 3. System Architecture

### 3.1 Layer Model

```
┌──────────────────────────────────────────────────────────┐
│  PRESENTATION      17 routes · Server Components          │
│                    Sidebar · Topbar · CommandPalette      │
├──────────────────────────────────────────────────────────┤
│  API               37 route handlers under app/api/*       │
├──────────────────────────────────────────────────────────┤
│  DOMAIN            Agent runtime · Chat orchestration ·    │
│                    Brain provider · Analytics · Funnel     │
├──────────────────────────────────────────────────────────┤
│  INTEGRATION       21 connectors → ConnectorStatus         │
│                    Credential resolution (lib/creds.ts)    │
├──────────────────────────────────────────────────────────┤
│  PERSISTENCE       Repository layer (lib/db.ts)            │
│                    Zod validation on egress                │
│                    SQLite/WAL — 27 tables                  │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Architectural Rule (mandatory)

**ARCH-1.** No page and no API route shall query SQLite directly. All persistence access shall pass
through the repository layer in `lib/db.ts`, obtained via the `getDb()` singleton in `lib/data.ts`.

**ARCH-2.** Any new data source shall be introduced as: *(a)* a new repository method, *(b)* a Zod
schema, *(c)* a seed entry, and *(d)* a test. All four are mandatory.

**ARCH-3.** Every value crossing the database or API boundary shall be validated by a Zod schema
defined in `lib/schemas.ts`.

**ARCH-4.** Heavy, interaction-driven visualisations shall be loaded via `next/dynamic` with
`ssr: false`, behind a dimension-matched skeleton. Enforced by `tests/code-splitting.test.ts`.

### 3.3 Technology Stack

| Concern | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (App Router) | 14.2.x |
| Language | TypeScript | 5.6 |
| UI | React + Tailwind CSS | 18.3 / 3.4 |
| Persistence | better-sqlite3 (WAL mode) | 11.x declared / 13.x required on Node ≥ 24 |
| Validation | Zod | 3.23 |
| Testing | Vitest | 2.1 |
| LLM access | Vercel AI SDK (`ai`) via AI Gateway | 6.x |
| Iconography | lucide-react, simple-icons | — |

---

## 4. Functional Requirements

### 4.1 Data & Persistence

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-1.1** | The system shall open or create a SQLite database at `FOUNDER_OS_DB`, defaulting to `data/founder-os.db`. | Must |
| **FR-1.2** | The system shall seed the database on first access such that every view is populated without configuration. | Must |
| **FR-1.3** | Seeding shall be idempotent (`INSERT OR REPLACE`); re-running shall add only missing content and destroy nothing. | Must |
| **FR-1.4** | Seeding shall back-fill databases created before a table existed, evaluated per-table, not by a single global flag. | Must |
| **FR-1.5** | The database handle shall be an application-level singleton. | Must |
| **FR-1.6** | The system shall support `FOUNDER_OS_DB=:memory:` for isolated test execution. | Must |
| **FR-1.7** | Every row read from the database shall be validated against its Zod schema before reaching the presentation layer. | Must |
| **FR-1.8** | The system shall provide a standalone re-seed command (`npm run seed`) reporting per-entity counts. | Should |

### 4.2 Connector Layer

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-2.1** | Every connector shall expose a status function returning a `ConnectorStatus` object. | Must |
| **FR-2.2** | `ConnectorStatus.state` shall be exactly one of `connected`, `not_configured`, `error`. | Must |
| **FR-2.3** | **The system shall never report `connected` for a connector it has not verified.** Absence of credentials shall yield `not_configured`. | Must |
| **FR-2.4** | `ConnectorStatus.detail` shall carry a human-readable cause, and for `not_configured` shall name the specific environment variable required. | Must |
| **FR-2.5** | All connector status checks shall execute in parallel. | Should |
| **FR-2.6** | A thrown exception in any single connector shall be caught and converted to `state: 'error'` without affecting other connectors or failing the request. | Must |
| **FR-2.7** | The system shall support the following 21 connectors: G-Brain, LLM Gateway, WhatsApp, Zernio, Beehiiv, ManyChat, Attio, WebinarJam, Trakyo, Meta Ads, GoHighLevel, Arcads, Wispr, Local Stack, Obsidian, Miro, Email (IMAP ×4), Google Calendar, Slack, Payments, Notion. | Must |
| **FR-2.8** | Connectors shall degrade gracefully to a lower-fidelity source where one exists (e.g. G-Brain: live DB → CLI → local grep) and shall disclose the active fidelity level. | Should |

### 4.3 Credential Management

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-3.1** | Credentials shall be resolved in the order: fresh `.env.local` read → `process.env` → external credential files. | Must |
| **FR-3.2** | `.env.local` shall be re-read at call time (not only at boot) so a newly-pasted key takes effect without a restart. | Must |
| **FR-3.3** | **No secret value shall ever be written into the repository.** External credential files shall be read in place at runtime. | Must |
| **FR-3.4** | Writing to `.env.local` shall preserve every unrelated line byte-for-byte. | Must |
| **FR-3.5** | `.env.local` shall be written with file mode `0600`. | Must |
| **FR-3.6** | The user interface shall display credential presence as a masked boolean (`set` / `not set`) and shall never echo a secret value back. | Must |
| **FR-3.7** | The system shall support reusing keys already registered in the operator's MCP configuration (`~/.config/mcp.json`) for Attio and ManyChat. | Should |
| **FR-3.8** | The system shall provide a UI flow to add, update, and remove credentials (`POST /api/connections/connect`, `/api/keys`). | Should |

### 4.4 Agent Runtime

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-4.1** | Every agent shall implement the `RuntimeAgent` contract with a mandatory `run(): Promise<AgentRunResult>`. | Must |
| **FR-4.2** | **Every seeded agent row shall map 1:1 to a runtime agent with a real `run()` implementation.** No decorative agents. Enforced by test. | Must |
| **FR-4.3** | Every invocation of `run()` shall persist an `agent_runs` record containing id, agentId, startedAt, finishedAt, ok, and summary. | Must |
| **FR-4.4** | A thrown exception inside `run()` shall be caught and recorded as `ok: false` with the error message as summary. **No invocation shall go unrecorded.** | Must |
| **FR-4.5** | An agent lacking required credentials shall fail with `ok: false` and a summary naming the exact remediation step. | Must |
| **FR-4.6** | Agents may optionally implement `respond(message)`; those that do not shall fall back to `run()` when addressed. | Must |
| **FR-4.7** | Agents may optionally expose `chatTools()` returning read-only tool specifications callable by the LLM mid-conversation. | Should |
| **FR-4.8** | The system shall expose `POST /api/agents/[id]/run` to trigger a single agent. | Must |
| **FR-4.9** | The system shall support broadcast: one message fanned out to the entire roster, executed in parallel, with every reply persisted to `broadcast_replies`. | Must |
| **FR-4.10** | The system shall present per-agent last-run state (timestamp, outcome) in the roster view. | Should |
| **FR-4.11** | The system shall support scheduled agent execution definitions (`agent_crons`) with cron-expression validation. | Should |

### 4.5 LLM & Conversational Layer

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-5.1** | LLM access shall route through a provider interface with a real `gateway` implementation (Vercel AI Gateway) and a deterministic `stub` implementation selectable via `LLM_PROVIDER`. | Must |
| **FR-5.2** | The `stub` provider shall make **no network call**, keeping the full agent-chat stack testable offline. | Must |
| **FR-5.3** | The system shall support multi-step tool-calling, bounded at **6 steps** per turn (`stopWhen: stepCountIs(6)`). | Must |
| **FR-5.4** | Tool results shall be matched to their originating call by `toolCallId`, never by array position. | Must |
| **FR-5.5** | Absence of `AI_GATEWAY_API_KEY` shall fail fast with an actionable message rather than hanging on the SDK. | Must |
| **FR-5.6** | Agent chat shall persist the user turn, all tool calls, and the assistant turn to `agent_messages`. | Must |
| **FR-5.7** | **Agents shall operate READ-ONLY.** The system prompt shall instruct every agent never to claim it has sent, created, scheduled, or published anything. | Must |
| **FR-5.8** | The chat system prompt shall optionally incorporate the operator's current screen context (capped at 4000 characters) for deictic grounding ("this", "here"). | Should |
| **FR-5.9** | The default model shall be configurable via `LLM_MODEL`, defaulting to `anthropic/claude-sonnet-5`. | Should |

### 4.6 Knowledge Layer (G-Brain)

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-6.1** | The system shall provide a single shared knowledge store queryable by every agent. | Must |
| **FR-6.2** | The G-Brain provider shall invoke the `gbrain` CLI (`doctor --json --fast`, `query --no-expand`). | Must |
| **FR-6.3** | When the backing database is unreachable, the provider shall fall back to local grep over the markdown brain-store. | Must |
| **FR-6.4** | `GET /api/brain?q=` shall perform a hybrid search; a bare `GET /api/brain` shall return provider status. | Must |
| **FR-6.5** | The system shall expose a knowledge graph view with node/edge navigation and a fullscreen mode. | Should |
| **FR-6.6** | The system shall surface G-Brain health as a 0–100 score, reported as `—` when unknown rather than as a fabricated value. | Must |
| **FR-6.7** | The provider shall be swappable via `BRAIN_PROVIDER` (`gbrain` \| `stub`). | Must |

### 4.7 Presentation & Navigation

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-7.1** | Navigation shall derive from a single source of truth (`lib/nav.ts`); the sidebar and command palette shall not be independently defined. | Must |
| **FR-7.2** | The command palette shall open on ⌘K / Ctrl-K and support digit keys 1–9 mapped to the first nine views **in visible order**. | Must |
| **FR-7.3** | Every route shall render without throwing, verified by an automated smoke test over all pages. | Must |
| **FR-7.4** | The application shall ship 5 selectable themes, defaulting to **Monolith Signal** (`mono`). | Must |
| **FR-7.5** | In the Monolith theme, colour shall convey **status only** — `ok`, `warn`, `err`. No decorative colour. | Must |
| **FR-7.6** | Theme tokens shall be defined both as Tailwind config values and as raw CSS custom properties, kept in sync, because SVG and `color-mix()` require `var()` access. | Must |
| **FR-7.7** | The layout shall comprise a fixed sidebar (grouped: Operate / Agents / Intelligence / System / Library) and a sticky topbar with breadcrumb. | Should |

### 4.8 Domain Views

| ID | Requirement | Priority |
| --- | --- | --- |
| **FR-8.1** | `/comms` shall aggregate email, Slack, WhatsApp, and dictation into one feed, with lane routing configurable by keyword (`COMMS_WORK_KEYWORDS`). | Must |
| **FR-8.2** | `/comms` shall support real outbound email replies over SMTP using each inbox's own credentials. | Should |
| **FR-8.3** | `/funnel` shall render a per-contact client journey with stage columns and 4–5 touch markers per path, in both linear and radial projections. | Must |
| **FR-8.4** | `/social` shall report per-platform audience over time across 7D/30D/60D/ALL windows for Instagram, TikTok, X, YouTube, LinkedIn, and the email list. | Must |
| **FR-8.5** | `/finances` shall report income, expenses by category, and shall support bank statement ingestion. | Should |
| **FR-8.6** | `/org` shall render the hierarchy operator → Conductor → 5 pillars → workers, with a broadcast composer. **Its markup is frozen and shall not be restructured.** | Must |
| **FR-8.7** | `/integrations` shall present the live connections board driven by `GET /api/connections`. | Must |
| **FR-8.8** | Where a live source is unavailable, a view shall either display seeded data clearly or display no number — **never a fabricated live figure**. | Must |

---

## 5. External Interface Requirements

### 5.1 API Surface (37 endpoints)

| Group | Endpoints |
| --- | --- |
| Agents | `GET /api/agents`, `POST /api/agents/[id]/run`, `POST /api/agents/[id]/chat`, `GET /api/agents/activity`, `POST /api/agents/broadcast`, `GET /api/agents/work` |
| Brain | `GET /api/brain`, `GET /api/brain/overview`, `GET /api/brain/graph`, `POST /api/brain/dump` |
| Comms | `GET /api/comms`, `POST /api/comms/reply` |
| Connections | `GET /api/connections`, `POST /api/connections/connect`, `GET/POST /api/keys` |
| Social | `GET /api/social`, `/api/social/[platform]`, `/history`, `/posts`, `/series`, `/sync`, `POST /api/social/dm/reply` |
| Finance | `GET /api/finances/statements`, `POST /api/finances/bank-statement` |
| Funnel | `GET /api/funnel`, `POST /api/funnel/lead-message` |
| Core | `/api/departments`, `/api/metrics`, `/api/tools`, `/api/roadmap`, `/api/skills`, `/api/skills/[slug]`, `/api/ventures`, `/api/contacts/tags`, `/api/life/map`, `/api/conductor/context` |
| Inbound | `POST /api/webhooks/manychat` |

### 5.2 Webhook Interface

| ID | Requirement |
| --- | --- |
| **EIR-1** | `POST /api/webhooks/manychat` shall accept inbound Instagram DM events. |
| **EIR-2** | When `MANYCHAT_WEBHOOK_SECRET` is set, the endpoint shall require a matching `x-manychat-secret` header. Unauthenticated acceptance is **development-only**. |

### 5.3 Third-Party Service Interfaces

Communications: IMAP ×4, SMTP, Slack Web API, WhatsApp, Wispr Flow (local SQLite, read-only).
Commerce: Stripe (balance + charges, read-only), PayPal, Square, Whop, FanBasis ×2, Wise ×2.
CRM & Attribution: Attio, WebinarJam, Trakyo, GoHighLevel, Meta Ads.
Content & Growth: Zernio, Beehiiv, ManyChat, Arcads, Miro.
Knowledge: G-Brain CLI + Supabase + ZeroEntropy, Obsidian vault, Notion, Google Calendar.

### 5.4 Environment Variables

`FOUNDER_OS_DB`, `FOUNDER_OS_ENV_LOCAL`, `BRAIN_PROVIDER`, `GBRAIN_BIN`, `GBRAIN_STORE`,
`LLM_PROVIDER`, `LLM_MODEL`, `AI_GATEWAY_API_KEY`, `INBOX_1..4_{HOST,USER,PASS,NAME,PORT,SMTP_HOST,SMTP_PORT}`,
`SLACK_BOT_TOKEN`, `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_{ID,SECRET}`, `SQUARE_ACCESS_TOKEN`,
`WHOP_API_KEY`, `FANBASIS_{VANTAGE,LC}_KEY`, `WISE_{1,2}_TOKEN`, `NOTION_API_KEY`,
`WEBINARJAM_API_KEY`, `TRAKYO_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `BEEHIIV_API_KEY`,
`BEEHIIV_PUBLICATION_ID`, `MANYCHAT_API_KEY`, `MANYCHAT_WEBHOOK_SECRET`, `COMMS_WORK_KEYWORDS`.

---

## 6. Data Requirements

### 6.1 Entity Inventory (27 tables)

| Domain | Tables |
| --- | --- |
| Organisation | `departments`, `agents`, `tools`, `domains`, `phases`, `personas`, `people` |
| Agent operations | `agent_runs`, `agent_messages`, `agent_tasks`, `agent_crons`, `broadcasts`, `broadcast_replies` |
| Planning | `roadmap_items`, `metrics`, `workflows`, `skills`, `sop_tasks` |
| Growth | `social_accounts`, `social_snapshots`, `social_posts`, `email_list_snapshots` |
| Messaging | `social_dms`, `social_dm_snapshots`, `social_dm_messages` |
| Pipeline | `funnel_contacts`, `funnel_touches`, `contact_tags` |

### 6.2 Data Rules

| ID | Requirement |
| --- | --- |
| **DR-1** | Array and object fields shall be stored as JSON text and parsed + validated on read. |
| **DR-2** | All timestamps shall be ISO 8601 strings in UTC. |
| **DR-3** | All primary keys shall be text; generated identifiers shall use `randomUUID()`. |
| **DR-4** | `agents.department_id` shall be a foreign key referencing `departments(id)`. |
| **DR-5** | SQLite shall run in WAL journal mode. |
| **DR-6** | The database file shall reside in `data/`, which shall be excluded from version control. |

---

## 7. Non-Functional Requirements

### 7.1 Reliability

| ID | Requirement |
| --- | --- |
| **NFR-1.1** | A failure in any single connector shall not fail the connections request or any page render. |
| **NFR-1.2** | A failure in any single agent shall not prevent other agents from executing during a broadcast. |
| **NFR-1.3** | The application shall be fully browsable with **zero** credentials configured. |
| **NFR-1.4** | Every credential file read shall be exception-safe, returning an empty record on any I/O failure. |

### 7.2 Performance

| ID | Requirement |
| --- | --- |
| **NFR-2.1** | The full test suite shall complete in under 30 seconds (currently ~10 s). |
| **NFR-2.2** | Connector health checks shall run concurrently, bounding total latency to the slowest single check. |
| **NFR-2.3** | Heavy visualisations shall be code-split and excluded from the server bundle. |
| **NFR-2.4** | G-Brain health probes shall use the CLI `--fast` path. |

### 7.3 Security

| ID | Requirement |
| --- | --- |
| **NFR-3.1** | Secrets shall never be committed to the repository, in any form, including examples. |
| **NFR-3.2** | Secrets shall never be rendered to the client; only presence booleans shall be transmitted. |
| **NFR-3.3** | The credential file shall be written with owner-only permissions (`0600`). |
| **NFR-3.4** | Agents shall have no write authority over external systems (see FR-5.7). |
| **NFR-3.5** | **[GAP]** The application implements **no authentication and no authorisation**. It shall be bound to localhost or a trusted private network only. Public exposure is prohibited. |

### 7.4 Maintainability

| ID | Requirement |
| --- | --- |
| **NFR-4.1** | Development shall follow TDD: a failing test precedes implementation. |
| **NFR-4.2** | Tests shall be organised one file per module under `tests/`. |
| **NFR-4.3** | `npm test && npm run typecheck` shall both pass before any change is considered complete. |
| **NFR-4.4** | The codebase shall remain free of TypeScript errors under `--noEmit`. |
| **NFR-4.5** | Concurrent development sessions shall commit small checkpoints frequently and leave handoff notes in `docs/`. |

### 7.5 Portability

| ID | Requirement |
| --- | --- |
| **NFR-5.1** | The application shall run on macOS, Linux, and Windows. |
| **NFR-5.2** | Filesystem paths shall be constructed with `node:path`, never by string concatenation. |
| **NFR-5.3** | Platform-specific data sources (Obsidian vault, Wispr SQLite, tmux, brew) shall degrade to `not_configured` on unsupported platforms rather than erroring. |

---

## 8. Design Constraints & Governing Principles

### 8.1 The `larp-first, real-ready` Principle

> The system looks alive because of rich seeded data, but every page and API route reads through the
> repository layer. Replacing seeded tables with live sources is a repository-level change — never a
> UI rewrite.

**CON-1.** This principle is load-bearing and shall not be violated for expedience.

### 8.2 The Honesty Principle

**CON-2.** The system shall never fabricate a favourable state. Specifically: no fake `connected`,
no invented metric, no agent claiming an action it did not perform. Every failure shall carry its
real cause and, where applicable, its remediation.

### 8.3 Visual Constraints

**CON-3.** Default theme **Monolith Signal**: background `#0a0a0a`, white accent, hairline
`#1c1c1c`, status colours only (`ok #2fd36f`, `warn #ffb000`, `err #ff2d3f`).
**CON-4.** Typography: JetBrains Mono exclusively; `font-sans` and `font-mono` both resolve to it.
**CON-5.** Zero border radius, square LED status indicators (blink, no pulse ring), hairline borders,
no shadows on cards.
**CON-6.** The `/org` markup is frozen; it inherits tokens through Tailwind classes only.

### 8.4 Operational Constraints

**CON-7.** The application shall bind to port 4100.
**CON-8.** Multiple concurrent development sessions may operate on the repository; the dev server on
4100 shall not be terminated unilaterally.

---

## 9. Assumptions and Dependencies

| ID | Assumption |
| --- | --- |
| **A-1** | Exactly one human operator uses the system; no access control is required at the application layer. |
| **A-2** | The host machine is trusted and physically controlled by the operator. |
| **A-3** | Credentials already exist in the operator's canonical filesystem locations. |
| **A-4** | External services remain API-compatible; breakage surfaces as an honest `error` state. |
| **A-5** | The `gbrain` CLI is installed and on `PATH` for full knowledge-layer function. |
| **A-6** | SQLite single-writer concurrency is sufficient for single-operator load. |
| **D-1** | `better-sqlite3` is a native module; it requires a prebuilt binary matching the Node ABI, or a C++ toolchain. **The declared `^11.3.0` has no binary for Node ≥ 24; `^13.x` is required there.** |
| **D-2** | Agent chat depends on the Vercel AI Gateway and an `AI_GATEWAY_API_KEY`. |

---

## 10. Explicitly Out of Scope

The following are **absent by design** in version 1.0 and shall not be assumed present:

| ID | Excluded capability |
| --- | --- |
| **OOS-1** | Authentication, session management, password handling |
| **OOS-2** | Authorisation, roles, permissions |
| **OOS-3** | Multi-tenancy or multi-user data isolation |
| **OOS-4** | Any customer-facing or public surface |
| **OOS-5** | Order, cart, checkout, or fulfilment processing |
| **OOS-6** | Autonomous write actions by agents against external systems |
| **OOS-7** | Background job queue, worker processes, or long-running task execution |
| **OOS-8** | Horizontal scaling, replication, or managed database hosting |
| **OOS-9** | Rate limiting, quota enforcement, abuse prevention |
| **OOS-10** | Regulatory compliance controls (GDPR data-subject flows, PCI scope, audit certification) |
| **OOS-11** | Mobile applications or responsive-first mobile design |
| **OOS-12** | Internationalisation / localisation |

---

## 11. Verification & Acceptance

### 11.1 Acceptance Criteria

| ID | Criterion | Status |
| --- | --- | --- |
| **AC-1** | `npm test` passes with zero failures | ✅ 869/869 |
| **AC-2** | `npm run typecheck` reports zero errors | ✅ |
| **AC-3** | All 17 routes return HTTP 200 | ✅ 16 verified + root redirect |
| **AC-4** | A fresh clone renders populated views with no credentials | ✅ |
| **AC-5** | Every seeded agent resolves to a runtime agent with `run()` | ✅ enforced by test |
| **AC-6** | No connector reports `connected` without verification | ✅ observed 0/21 on an unconfigured host |
| **AC-7** | Agent runs persist regardless of outcome | ✅ observed honest `ok:false` with real cause |
| **AC-8** | No secret appears in the repository | ✅ `.env.local` gitignored; `.env.example` has empty values |

### 11.2 Test Coverage Map

98 test files, one per module, covering: schemas, repositories, seeding, every connector,
agent runtime, agent tools, chat orchestration, brain provider and graph, funnel projections,
social aggregation, finance calculations, theme palette, navigation/command-palette parity,
code-splitting contract, and a full-platform render smoke test.

### 11.3 Test Isolation

All database-touching tests use `FOUNDER_OS_DB=:memory:`. All LLM-touching tests use
`LLM_PROVIDER=stub`. The suite makes **no network calls**.

---

## Appendix A — Glossary

| Term | Definition |
| --- | --- |
| **Agent** | A named non-human actor with a scoped job and an executable `run()` implementation. |
| **Conductor** | The super-agent that fans a message out to the full roster and aggregates replies. |
| **Connector** | An integration module exposing one external service's real state as a `ConnectorStatus`. |
| **G-Brain** | The shared knowledge layer: markdown store + Supabase backend + ZeroEntropy embeddings, accessed via the `gbrain` CLI. |
| **Instance slot** | A top-level agent positioned to become its own external process (OpenClaw Hermes / Claude Code) once a dedicated host exists. |
| **larp-first, real-ready** | The governing architecture rule: seeded data behind a repository layer, so live sources swap in without UI change. |
| **Monolith Signal** | The default theme: pure black, white accent, colour reserved for status. |
| **Operator** | The single human user. |
| **Pillar** | One of the five departmental groupings: Sales, Marketing/Growth, TECH, Finances, Communications. |
| **Repository layer** | The mandatory abstraction (`lib/db.ts`) between all consumers and SQLite. |
| **Run** | A single agent execution, always persisted to `agent_runs`. |

---

## Appendix B — Known Gaps & Technical Debt

| ID | Item | Severity | Notes |
| --- | --- | --- | --- |
| **TD-1** | `package.json` declares `better-sqlite3: ^11.3.0`, which cannot install on Node ≥ 24 without a C++ toolchain. | **High** | Resolve by bumping to `^13.x` or pinning Node 22 LTS. |
| **TD-2** | Theme tokens are duplicated between `tailwind.config.ts` and `app/globals.css` and must be synchronised by hand. | Medium | No test enforces parity. Most fragile point in the codebase. |
| **TD-3** | Prior `tool` turns are dropped before the model call, so multi-turn tool reasoning is not supported. | Medium | Documented in `lib/agents/chat.ts`; acceptable for read-only v1. |
| **TD-4** | No authentication of any kind. | **High** (for any non-local deployment) | See NFR-3.5. |
| **TD-5** | Agent runs execute synchronously inside the HTTP request. | Medium | Any run exceeding the request timeout cannot complete. |
| **TD-6** | Several connectors resolve credentials from macOS-specific absolute paths. | Low | Degrades honestly on other platforms. |
| **TD-7** | `npm audit` reports 13 vulnerabilities (1 critical, 9 high) in the dependency tree. | Medium | Requires triage before any exposed deployment. |

---

*End of specification.*
