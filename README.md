# Appsgain AI Sales Agent

Multi-tenant SaaS platform for AI voice agents that find, call, qualify and convert
leads. See [`docs/`](./docs) for the source specifications.

| Doc | What it covers |
| --- | --- |
| [docs/brand-guidelines.md](docs/brand-guidelines.md) | Colour palette, typography, UI component style guide |
| [docs/trd.md](docs/trd.md) | Architecture, tech stack, data model, APIs, NFRs |
| [docs/features.md](docs/features.md) | Module-by-module feature list with priority and phase |
| [docs/workflow.md](docs/workflow.md) | Onboarding, lead, campaign, calling and billing flows |

## Running it locally

Two commands. The first brings up the databases, the second brings up the apps.

```bash
cp .env.example .env
docker-compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

**No Docker?** `npm run db:dev` starts a Postgres that needs nothing installed — PGlite,
real PostgreSQL compiled to WebAssembly, served over the Postgres wire protocol on 5432.
Prisma connects to it with an ordinary `DATABASE_URL` and neither the schema nor any
application code knows the difference, so migrations, enums, arrays and transactions all
behave as they will in production. It is single-process and stores to `apps/api/.pglite`,
so it is a development convenience only — never point a deployment at it.

```bash
npm run db:dev      # leave running in one terminal
npm run db:migrate
npm run db:seed
npm run dev
```

The seed creates two workspaces so tenant isolation is observable rather than assumed.
Sign in at http://localhost:3000/sign-in — the form lists the demo accounts, all with the
password `Appsgain#2026`:

| Login | Role | Workspace |
| --- | --- | --- |
| `owner@northwind.test` | Owner | Northwind Solutions |
| `manager@northwind.test` | Manager | Northwind Solutions |
| `agent@northwind.test` | Agent | Northwind Solutions |
| `viewer@northwind.test` | Viewer | Northwind Solutions |
| `owner@cobalt.test` | Owner | Cobalt Interactive |

| URL | What |
| --- | --- |
| http://localhost:3000 | Web dashboard |
| http://localhost:3000/style-guide | Design system QA page |
| http://localhost:4000/api | REST API |
| http://localhost:4000/api/health | API liveness / readiness |
| http://localhost:8000/docs | AI service (started separately, see below) |

`docker-compose up` runs **only the databases** — Postgres on 5432, a second Postgres for
tests on 5433, and Redis on 6379. The apps themselves run on the host so that a code
change is a hot reload rather than a container rebuild.

The Python service is not part of `npm run dev`, because it needs its own virtualenv:

```bash
python -m venv apps/ai-service/.venv
apps/ai-service/.venv/Scripts/activate   # macOS/Linux: source apps/ai-service/.venv/bin/activate
pip install -r apps/ai-service/requirements.txt
npm run dev:ai
```

### Other scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Builds shared, then web and api |
| `npm run lint` | ESLint across web and api |
| `npm run format` | Prettier across the repo |
| `npm run typecheck` | `tsc --noEmit` across every TypeScript package |
| `npm test` | API unit tests — no database needed |
| `npm run test:e2e` | API integration tests — needs `docker-compose up -d postgres-test` |
| `npm run db:migrate` | Prisma migration against the dev database |
| `npm run db:studio` | Prisma Studio |

## Layout

```
apps/
  web/          Next.js 14 · TypeScript · TailwindCSS · Recharts
  api/          NestJS · TypeScript · Prisma · PostgreSQL
  ai-service/   Python · FastAPI — LLM orchestration, STT/TTS
packages/
  shared/       TypeScript types shared by web and api. No runtime dependencies.
docs/           Specifications, exported from the source .docx files
docker-compose.yml   Postgres (dev + test) and Redis
```

## Status

| Phase | State |
| --- | --- |
| 0 — Monorepo scaffolding, docker-compose, shared ESLint/Prettier | Done |
| 1 — Multi-tenant auth: Prisma models, JWT, tenant guard, `POST /workspace` | Done |
| 2 — Design tokens, `components/ui`, `/style-guide` | Done |
| 3 — Dashboard shell, navigation, layout | Done |
| 4 — Leads: Prisma model, REST endpoints, CSV import, Leads list + detail | Done |
| 5 — Find Leads (AI), Campaigns, AI Calling, Call History, Recordings, Settings | UI done, no API |
| 6 — Transcripts, Sales Notes, Follow-ups, Analytics, Plans | UI done, no API |
| 7 — Auth and onboarding screens, Appsgain brand lockup | UI done, no API |
| 8–13 — Calling pipeline, follow-up automation, billing, compliance | Not started |

### Screens

| Route | What |
| --- | --- |
| `/welcome` | Entry screen — product pitch, then into the flow |
| `/sign-in` | Sign in — email, password, Google and Microsoft SSO |
| `/sign-up` | Create account — name, business email, phone, password |
| `/verify-email` | Six-digit code, resend countdown |
| `/forgot-password` | Request a reset link |
| `/reset-password` | New password with a strength meter; `/success` confirms |
| `/onboarding/role` | Role picker — owner, agent or team member |
| `/onboarding/business` | Company name, city, industry template |
| `/onboarding/done` | Welcome, then into the dashboard |
| `/` | Dashboard — KPIs, call outcomes, live calls, recent leads, AI notes |
| `/leads` | Lead database — search, six filters, table, details panel |
| `/leads/[id]` | Lead detail — activity timeline, AI summary, tabs |
| `/leads/import` | CSV import — upload, column mapping, de-duplication preview |
| `/find-leads` | AI lead discovery — prompt search, source breakdown |
| `/campaigns` | Campaign list, performance chart, lead-status donut |
| `/ai-calling` | Live console — call status, live calls, monitor, manual dialer |
| `/call-history` | Call log with recording, transcript and notes panel |
| `/recordings` | Recording library with player, transcript and tags |
| `/transcripts` | Transcript log — player, timed turns, AI summary, call notes |
| `/sales-notes` | Note log — type and sentiment, note body, tags, next action |
| `/follow-ups` | Follow-up queue — schedule, notes, previous call, next actions |
| `/analytics` | Calls trend, agent performance, funnel, leads by city, insights |
| `/plans` | Plan chooser — four tiers, monthly/yearly toggle, comparison grid |
| `/settings` | Profile, team, billing, integrations, call settings, notifications, security, workspace |
| `/style-guide` | Design-system QA — every `components/ui` component |

Every screen renders from `apps/web/lib/mock-*.ts`. Those shapes already match the
responses the corresponding endpoints are specified to return (TRD §8), so wiring each
one up is swapping an import rather than rewriting a component. `lib/leads-repository.ts`
already prefers the live API when it is reachable and falls back to the seed set
otherwise — it says which it used, in the console and on screen.

## Integrations

Settings → Integrations has three sections, each backed by the API:

- **Apps** — 37 providers across CRM, communication, calendar, telephony, AI, voice,
  storage, automation and analytics (`GET /api/integrations`). Pasted credentials are
  checked with the vendor before they are stored, encrypted with
  `CREDENTIALS_ENCRYPTION_KEY`. Each card states what connecting it does today: HubSpot,
  Salesforce, Zoho, Pipedrive and Freshsales receive new leads; Slack, Teams and Google Chat
  post the events you pick; GA4, Mixpanel and PostHog receive events without names or phone
  numbers; SendGrid and Resend send notification email; Google Calendar and Outlook mirror
  calendar events; Zapier, Make, n8n and Pabbly are triggered through signed webhooks.
  Telephony, AI, voice and storage accounts are verified and stored, but calls still run on
  the sandbox until live adapters exist — the Calling pipeline card says so.
- **Webhooks** — `CRUD /api/webhooks`. Every delivery is signed
  (`X-Appsgain-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`), logged, and retried
  after 1 min, 5 min, 30 min, 2 h and 8 h. Events: `lead.created`, `leads.imported`,
  `lead.status_changed`, `call.completed`, `call.outcome_changed`, `followup.due`,
  `credits.low_balance`.
- **API keys** — `agk_…` keys for the REST API, sent as `X-API-Key`. Scoped to sales
  data only, never more than their creator currently holds, refused on account and settings
  endpoints, and dead on their next request once revoked.

Google Calendar, Outlook and Salesforce connect with OAuth and need an app registered by
whoever runs the server: set the `*_OAUTH_CLIENT_ID` / `*_OAUTH_CLIENT_SECRET` pairs plus
`API_PUBLIC_URL` and `WEB_APP_URL` (see `.env.example`), and register
`<API_PUBLIC_URL>/api/integrations/oauth/callback` as the redirect URI with each vendor.
Retries and `followup.due` run on an in-process 30-second worker
([integrations.worker.ts](apps/api/src/integrations/integrations.worker.ts)).

## Four conventions worth keeping

**Tenant isolation is enforced twice, in different places.** `TenantGuard`
([apps/api/src/auth/guards/tenant.guard.ts](apps/api/src/auth/guards/tenant.guard.ts))
rejects a request that *names* a tenant other than its token's. The scoped Prisma client
([apps/api/src/prisma/tenant-scoped.ts](apps/api/src/prisma/tenant-scoped.ts)) filters
every query by tenant whether or not the calling code remembered to. The guard alone
would not survive a service method written six months from now that forgets its `where`;
that is exactly the case the second layer covers, and
[the integration tests](apps/api/test/tenant-isolation.e2e-spec.ts) attack both.

**A tenant id only ever comes from a signed token.** Never from a URL, a header or a
body — `ValidationPipe` is configured with `forbidNonWhitelisted`, so a request that
tries to smuggle one in is rejected rather than silently stripped.

**Colour is semantic, never decorative.** `apps/web/lib/status.ts` is the single table
mapping every lead status, call status, outcome and source to a tone. Badges, donut
slices and chart series all read from it, which is what keeps green meaning "interested"
in every place it appears. No component holds a raw hex.

**Two brands, two config objects.** `config/app-brand.ts` is Appsgain, the vendor —
the auth screens, the sidebar mark, the CTA gradient. `config/branding.ts` is the tenant
workspace the dashboard renders itself in. They are separate so a white-labelled customer
can change its own colours without repainting the vendor's logo, and so the pre-login
screens have something to wear before a tenant exists. `components/brand/logo.tsx` draws
the lockup; swapping in supplied artwork is one component, not a search across screens.

**Nothing hard-codes the tenant.** The seed workspace is a generic B2B reseller, but
its name, monogram, tagline and colours all come from `apps/web/config/branding.ts`,
standing in for the `branding_config` column on `Tenant` (TRD §12). Swapping that object
rebrands the whole app — which is the white-label requirement, tested from day one.
