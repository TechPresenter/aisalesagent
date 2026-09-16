Technical Requirements Document
Appsgain AI Sales Agent — TRD v1.0
Prepared for Appsgain Technologies  ·  September 2026

# Document Control
| Version | Date | Author | Status |
| 0.1 | Sep 2026 | Product & Engineering | Draft — for internal review |


# 1. Introduction & Purpose
This document specifies the technical requirements for the Appsgain AI Sales Agent: a multi-tenant SaaS platform that lets any business run AI voice agents which find, call, qualify, and convert leads. It is written for Appsgain Technologies' engineering, product, and QA teams to plan, build, and validate the platform, and covers architecture, technology choices, data model, APIs, and non-functional requirements.
Appsgain will both operate the platform for its own internal outbound sales team and sell it as a subscription product to client businesses (“workspaces”/“tenants”) across any industry.

# 2. Product Vision & Objectives
Let any business turn a list of leads into booked demos and closed deals without hiring a large outbound calling team.
Give every AI call full transparency: live status, live audio access, transcript, AI summary, and lead score.
Keep a human in control at all times — Listen Live, Barge-in, and End Call are always available.
Support any industry out of the box via configurable Industry Templates (call scripts, lead fields, compliance rules).
Run as a single, efficient multi-tenant platform rather than one deployment per client, while still allowing full white-label branding per workspace.

# 3. Business Model & Scope

### Business model
Multi-tenant SaaS, sold on a credit/call-based subscription (Starter / Growth / Enterprise), plus an internal “Appsgain” workspace used by Appsgain's own sales team. A Super Admin layer, invisible to tenants, lets Appsgain provision, monitor, and support every workspace from one console.

### In scope — v1 / MVP
Tenant onboarding, team & role management, white-label branding
Lead management: manual upload + AI-assisted lead discovery
Campaign builder with AI script/voice/language selection and scheduling
Outbound AI calling with live monitoring (Listen Live, Barge-in, End Call)
Automatic transcription, AI call summary, and lead scoring
Call history, recordings, follow-up tasks
Core dashboard analytics and the Super Admin console
Credit-based billing and payment integration
India-first compliance: DND/DLT scrubbing, consent disclosure, data retention controls

### Out of scope — later phases
Deep CRM two-way sync (Salesforce/HubSpot/Zoho) — Phase 2
Inbound call handling / IVR — Phase 3
Predictive/parallel dialing at large scale — Phase 2
Custom-report builder and white-labelled mobile apps — Phase 3

# 4. User Roles & Personas
| Role | Description | Key Permissions |
| Appsgain Super Admin | Appsgain's internal platform team | Provision/suspend tenants, platform-wide analytics, impersonate-for-support, feature flags |
| Workspace Owner | Primary account holder for a tenant; billing owner | Full workspace control, billing, team management |
| Workspace Admin | Tenant-side administrator | Manage users, integrations, campaigns, settings (no billing) |
| Sales Manager | Runs campaigns and oversees agents | Create/launch campaigns, monitor live calls, view analytics |
| Sales Agent / Viewer | Works leads and follow-ups | View assigned leads/calls, manage own follow-ups, read-only analytics |
| AI Voice Agent | System actor — not a human user | Executes calls per campaign script within guardrails; cannot change settings or billing |
| Prospect / Lead | External party receiving calls | No platform access; subject of consent & data-rights controls |


# 5. System Architecture
High-level view: client applications talk to a tenant-aware API gateway, which routes to a set of focused services. Core business data lives in PostgreSQL; call audio lives in object storage; transcripts are indexed for search; Redis handles caching, job queues, and the pub/sub channel that drives real-time dashboard updates (e.g. the “12 calls in progress” live view).
Figure 1 — High-level system architecture

### Multi-tenancy approach
Default (Starter/Growth): shared database with row-level isolation via a tenant_id column enforced at the ORM and API-gateway layer — cost-efficient at scale and simplest to operate.
Enterprise option: dedicated schema or dedicated database per tenant for clients with stricter data-residency or regulatory requirements.
Every request is authenticated and scoped to exactly one tenant_id; the Super Admin role is the only one that can query across tenants, and every cross-tenant action is audit-logged.

### Real-time updates
Live call status (Dialing → Ringing → Talking → Completed) is pushed to the dashboard over WebSockets, backed by a Redis pub/sub channel per tenant, so KPI cards, the Live Calls table, and the header's “AI Agent Running” indicator update without polling.

# 6. Technology Stack
| Layer | Technology | Rationale |
| Frontend | React + TypeScript, Next.js, TailwindCSS, Recharts | Fast SSR-capable dashboard; Recharts matches the donut/line chart style directly |
| Core Backend API | Node.js + NestJS (TypeScript) | Structured, modular services; shares types with the frontend |
| AI / Voice Service | Python + FastAPI | Richest ecosystem for LLM orchestration, STT/TTS integration, and audio processing |
| Primary Database | PostgreSQL | Relational integrity for tenants, leads, campaigns, billing |
| Cache / Queues / Pub-Sub | Redis | Session cache, dialer job queue, real-time call-status channel |
| Object Storage | S3-compatible (AWS S3 / GCS) | Call recordings, exported reports |
| Search Index | OpenSearch / Elasticsearch | Full-text transcript search |
| Telephony | Twilio (global) + Exotel / Ozonetel (India) | Abstracted via a telephony-provider interface; India providers simplify DLT/DND compliance |
| LLM | Claude or GPT-4-class model via API | Conversation reasoning, objection handling, summarization |
| Speech-to-Text / Text-to-Speech | Cloud STT (e.g. Google/Azure) + neural TTS (e.g. ElevenLabs/Azure) with Hindi + English + regional-language voices | Matches bilingual/code-mixed calling shown in the reference product |
| Infrastructure | AWS, Docker, Kubernetes, Terraform | Horizontal scaling, reproducible environments |
| CI/CD & Observability | GitHub Actions, Datadog/Grafana + Prometheus | Automated deploys; call-pipeline and API monitoring |
| Auth | JWT + OAuth2, SAML/SSO for Enterprise | Tenant-aware auth with enterprise-grade options |


# 7. Data Model
Key entities and relationships (simplified; every table includes a tenant_id foreign key except Tenant itself):
| Entity | Key Fields | Relationships |
| Tenant (Workspace) | id, name, industry_vertical, plan_id, branding_config, status | Root of all tenant-scoped data |
| User | id, tenant_id, name, email, role, status | Belongs to one Tenant |
| Lead | id, tenant_id, name, phone, city, source, status, score, custom_fields | Belongs to Tenant; has many Calls |
| Campaign | id, tenant_id, name, script_id, segment, schedule, status | Belongs to Tenant; has many Calls |
| Call | id, tenant_id, lead_id, campaign_id, persona_id, status, outcome, duration, recording_url | Belongs to Lead & Campaign; has one Transcript, one SalesNote |
| Transcript | id, call_id, content, language | Belongs to Call |
| SalesNote (AI Summary) | id, call_id, summary_text, lead_score, key_points | Belongs to Call |
| FollowUp | id, tenant_id, lead_id, due_date, type, status, assigned_to | Belongs to Lead |
| AIAgentPersona | id, tenant_id, name, voice_id, language, script_template_id | Belongs to Tenant; used by Campaigns |
| Plan / Subscription | id, tenant_id, plan_name, credits_included, credits_used, renewal_date | Belongs to Tenant |
| CreditLedger | id, tenant_id, type, amount, balance_after, related_call_id | Belongs to Tenant |
| Notification | id, tenant_id, user_id, type, content, read_status | Belongs to User |
| Integration | id, tenant_id, provider, credentials(encrypted), status | Belongs to Tenant |


# 8. API Design
REST API, JSON payloads, JWT bearer auth; every endpoint is implicitly scoped to the caller's tenant_id except the /admin/* group, which requires the Super Admin role.
| Endpoint group | Examples | Notes |
| /auth | POST /auth/login, /auth/refresh, /auth/sso | Issues short-lived JWT + refresh token |
| /admin | GET/POST /admin/tenants, /admin/tenants/{id}/suspend | Super Admin only; every call audit-logged |
| /workspace | GET/PUT /workspace/settings, /workspace/branding | Branding, industry template, compliance settings |
| /users | CRUD /users, POST /users/invite | Team & role management |
| /leads | CRUD /leads, POST /leads/import, POST /leads/ai-find | Bulk import and AI-assisted discovery |
| /campaigns | CRUD /campaigns, POST /campaigns/{id}/launch|pause | Campaign lifecycle |
| /calls | GET /calls, GET /calls/{id}, POST /calls/{id}/end | Call history & control |
| /calls/live (WebSocket) | subscribe: tenant channel | Real-time call-status stream for the dashboard |
| /calls/{id}/listen | POST — returns a signed live-audio stream URL | Listen Live |
| /transcripts | GET /transcripts/{call_id} | Full transcript text |
| /sales-notes | GET /sales-notes/{call_id} | AI summary + lead score |
| /follow-ups | CRUD /follow-ups | Task management |
| /analytics | GET /analytics/dashboard, /analytics/funnel | Aggregated KPIs |
| /billing | GET /billing/usage, POST /billing/recharge | Credits, invoices, payments |
| /integrations | POST /integrations/{provider}/connect | OAuth connect flow for CRM/calendar |
| /webhooks | CRUD /webhooks | Tenant-configured outbound event subscriptions |


### Key webhook events
call.completed, call.outcome_changed, lead.created, lead.status_changed, followup.due, credits.low_balance

# 9. AI & Voice Pipeline
Every AI-handled call runs the same turn-based loop: incoming audio → Speech-to-Text → LLM reasoning against the campaign's script and live conversation context (including objection-handling rules) → Text-to-Speech response. The loop repeats until the call ends, is escalated (Barge-in), or is force-ended.
Target round-trip latency per conversational turn: under 1.2 seconds (STT+LLM+TTS combined) to keep the call feeling natural.
Scripts are stored as structured prompt templates per Industry Template, with tenant-level customization of tone, key talking points, and disclosure language.
Outcome classification (Interested / Follow-up / Not Interested / No Answer / Wrong Number) and lead scoring run immediately after call end, using the full transcript plus call metadata.
Language support: Hindi, English, and Hindi-English code-mixed conversation at launch, with an extensible language pack model for additional regional languages.

# 10. Non-Functional Requirements

### Performance
| Metric | Target |
| Dashboard initial load | < 2s (p95) on broadband |
| Standard API response time | < 300ms (p95) |
| AI-heavy endpoints (scoring, summary) | < 1.5s (p95) |
| Conversational turn latency (AI call) | < 1.2s (p95) |
| Concurrent live calls | Starter: 10 · Growth: 50 · Enterprise: custom, horizontally scalable |


### Availability
Uptime SLA: 99.9% (Growth & Enterprise), 99.5% (Starter).
Backup targets: RPO 1 hour / RTO 4 hours (Starter & Growth); RPO 15 min / RTO 1 hour (Enterprise).

### Security
Encryption at rest (AES-256) and in transit (TLS 1.2+) for all data, including recordings and transcripts.
Role-based access control at API and UI layers; every admin action and data export is audit-logged and retained for at least 12 months.
Secrets and third-party credentials stored in a managed secrets vault, never in application config.

### Compliance
India: DND/DLT registry scrubbing before every dial; consent disclosure spoken at the start of each call; Digital Personal Data Protection Act (DPDP) 2023 data-subject access & erasure tooling.
International tenants: configurable compliance modules for GDPR (EU) and TCPA-style consent/opt-out rules (US) — Phase 2.
Call-recording retention is configurable per tenant (default 180 days) with automatic archive-or-delete on expiry.

# 11. Third-Party Integrations
| Category | Providers | Purpose |
| Telephony | Twilio, Exotel, Ozonetel | Call placement, PSTN connectivity |
| LLM | Claude, GPT-4-class | Conversation reasoning & summarization |
| Speech | Cloud STT/TTS providers | Voice in/out for the AI agent |
| CRM | Salesforce, HubSpot, Zoho | Lead & activity sync — Phase 2 |
| Calendar | Google Calendar, Outlook | Demo scheduling |
| Messaging | WhatsApp Business API | Automated follow-up messages — Phase 2 |
| Payments | Razorpay, Stripe | Subscription billing & credit top-ups |
| Automation | Zapier / Make, generic webhooks | Custom tenant workflows — Phase 3 |


# 12. Multi-Tenancy & White-Labeling
Each workspace can set its own logo, color theme, and AI agent persona name/voice, matching the Brand Guidelines' component system so the underlying UI never has to be rebuilt per client.
Workspaces get a subdomain (e.g. tenantname.appsgain.app) by default; Enterprise workspaces can map a custom domain.
Plan tiers gate features and concurrency (Starter / Growth / Enterprise); credits are consumed per completed call-minute and tracked in the CreditLedger.

# 13. Deployment & DevOps
Environments: Development → Staging → Production, with production changes gated behind CI checks and a manual approval step.
Infrastructure as Code (Terraform) for all cloud resources; containerized services orchestrated with Kubernetes.
Blue/green or rolling deploys to avoid downtime during releases, especially for the always-on calling pipeline.
Centralized logging and metrics (Datadog/Grafana + Prometheus) with alerting on call-failure rate, API error rate, and queue backlog.

# 14. Analytics & Reporting Requirements
Standard dashboard: Total Calls, Talked, Interested, Demo Booked, Leads Found by AI, Call Outcomes, Calls Trend, Lead Sources — all filterable by date range.
Funnel view: Called → Talked → Interested → Demo Booked → Converted, with drop-off rates at each stage.
Campaign-level ROI and AI-persona performance comparisons.
Scheduled digest emails (daily/weekly) — Phase 2. Custom report builder — Phase 3.

# 15. Success Metrics / Product KPIs
| KPI | Target (post-launch) |
| Tenant activation (first campaign launched within 7 days of signup) | ≥ 70% |
| Average call-connect rate | ≥ 35% |
| Average AI-to-human handoff accuracy (correct outcome classification) | ≥ 90% |
| Platform uptime | ≥ 99.9% (Growth/Enterprise tenants) |
| Monthly tenant churn | < 3% |


# 16. Assumptions, Dependencies & Risks
| Item | Type | Notes |
| Third-party telephony providers offer reliable India + global PSTN coverage | Dependency | Mitigate with a dual-provider abstraction layer |
| LLM/STT/TTS providers meet the sub-1.2s latency target | Risk | Benchmark providers during Phase 0; fall back to a secondary provider per component |
| Tenants provide accurate consent/compliance configuration | Assumption | Provide guided compliance setup and default-safe settings |
| Regulatory rules (DND/DLT, DPDP) may change | Risk | Compliance module is externally configurable, not hard-coded |


# 17. Glossary
| Term | Meaning |
| Tenant / Workspace | One client business's isolated instance of the platform |
| AI Agent Persona | A configured AI voice identity (name, voice, language, script) |
| Lead Score | 0–100 AI-generated estimate of conversion likelihood |
| DND/DLT | India's Do-Not-Disturb registry and Distributed Ledger Technology-based commercial-communication registration |
| Barge-in | A human agent joining/taking over a live AI call |

