Feature List
Appsgain AI Sales Agent — Full Product Specification
Prepared for Appsgain Technologies  ·  September 2026

# How to read this document
Every feature is tagged with a Priority and a Phase.
| Priority | Meaning |
| Must | Required for launch — the product doesn't work without it |
| Should | Important, targeted for launch where feasible |
| Could | Valuable but deferrable without blocking launch |

| Phase | Meaning |
| MVP | First launch |
| P2 | Second release wave, ~3–6 months post-launch |
| P3 | Later maturity phase |


# 1. Dashboard & Overview
The tenant's home screen — matches the reference layout of KPI cards, charts, live calls, and AI notes.
| Feature | Description | Priority | Phase |
| Real-time KPI cards | Total Calls, Talked, Interested, Demo Booked, Leads Found by AI — each with trend % and sparkline | Must | MVP |
| Call Outcomes donut chart | Interested / Follow-up / Not Interested / No Answer / Wrong Number breakdown | Must | MVP |
| Calls Trend chart | Total vs Interested calls over a selectable date range | Must | MVP |
| Lead Sources donut chart | Your Upload vs AI Found split | Must | MVP |
| Live Calls table | Real-time list of in-progress calls with status | Must | MVP |
| Live Call detail panel | Waveform, agent avatar, Listen Live, End Call | Must | MVP |
| Recent Leads table | Latest leads with quick status view | Must | MVP |
| AI Sales Notes panel | Latest call transcript preview + AI summary + lead score | Must | MVP |
| Global date-range filter | Applies across all dashboard widgets | Should | MVP |
| Dashboard personalization | Rearrange/hide widgets per user | Could | P3 |


# 2. Leads Management
| Feature | Description | Priority | Phase |
| Central lead database | Search, filter, and tag across all leads | Must | MVP |
| Bulk CSV/XLSX import | Column mapping and de-duplication on import | Must | MVP |
| Manual lead entry | Add a single lead via form | Must | MVP |
| Lead detail view | Contact info, full call history, notes | Must | MVP |
| Lead status pipeline | New → Contacted → Interested/Follow-up/… → Converted/Lost | Must | MVP |
| AI lead scoring | 0–100 conversion-likelihood score | Should | MVP |
| Lead assignment | Assign to a specific agent or AI persona | Should | P2 |
| Custom lead fields | Per-Industry-Template custom fields | Should | P2 |
| Duplicate detection & merge | Identify and merge duplicate lead records | Could | P2 |


# 3. Find Leads (AI)
| Feature | Description | Priority | Phase |
| AI-powered lead discovery | Find candidate leads by industry, location, and criteria | Must | MVP |
| Configurable search criteria | Industry, city, company size, keywords | Must | MVP |
| Review & approve workflow | Approve AI-found leads into the database | Should | MVP |
| Auto-enrichment | Fill missing phone/category/size on uploaded leads | Should | P2 |
| Scheduled discovery jobs | Recurring AI lead searches | Could | P2 |


# 4. Campaigns
| Feature | Description | Priority | Phase |
| Campaign builder | Name, target segment, schedule, calling window | Must | MVP |
| Script selection & customization | Choose/edit the AI script per campaign | Must | MVP |
| Voice & language selection | Per-campaign AI persona, language, and accent | Must | MVP |
| Scheduling | Start/end date, daily call windows, timezone-aware | Must | MVP |
| Pause / resume / stop controls | Full campaign lifecycle control | Must | MVP |
| Pre-launch compliance check | DND/DLT scrub and consent-flag validation before launch | Must | MVP |
| Campaign performance summary | Calls made, outcomes, conversion rate | Should | MVP |
| Script A/B testing | Compare two scripts within one campaign | Could | P3 |


# 5. AI Calling (Live Console)
| Feature | Description | Priority | Phase |
| Live “calls in progress” indicator | Header-level real-time badge | Must | MVP |
| Live call status transitions | Dialing → Ringing → Talking → Completed | Must | MVP |
| Live audio waveform | Visual indicator of the live call | Should | MVP |
| Listen Live | Silent monitoring of an active AI call | Must | MVP |
| Force End Call | Immediately end an active call | Must | MVP |
| Barge-in | Human takes over a live AI call | Should | P2 |
| Concurrent-call limits | Configurable per tenant/plan | Must | MVP |
| AI persona management | Name, voice, avatar, language, tone per persona | Should | MVP |
| Predictive dialer / retry logic | Auto-retry on no-answer with configurable rules | Should | P2 |


# 6. Call History
| Feature | Description | Priority | Phase |
| Full call log | Filter by date, outcome, agent, campaign, lead | Must | MVP |
| Call detail drill-down | Duration, outcome, recording and transcript links | Must | MVP |
| Export call history | CSV/XLSX export | Should | MVP |
| Bulk actions | Tag or assign follow-up across multiple calls | Could | P2 |


# 7. Recordings
| Feature | Description | Priority | Phase |
| Automatic call recording | Where legally permitted and consented | Must | MVP |
| In-browser playback | Waveform scrubber, speed control | Must | MVP |
| Recording download | Export a single recording | Should | MVP |
| Retention policy | Configurable auto-archive/delete per tenant | Must | MVP |
| Access audit log | Who accessed/downloaded which recording | Should | P2 |


# 8. Transcripts
| Feature | Description | Priority | Phase |
| Automatic transcription | AI-generated speech-to-text per call | Must | MVP |
| Bilingual/code-mixed support | E.g. Hindi-English mixed conversation | Must | MVP |
| Speaker-labeled transcript | AI Agent vs Prospect turns clearly marked | Must | MVP |
| Full-text transcript search | Search across every call's transcript | Should | P2 |
| Transcript export | TXT/PDF export | Should | MVP |


# 9. Sales Notes & AI Summaries
| Feature | Description | Priority | Phase |
| Auto-generated call summary | Plain-language summary per call | Must | MVP |
| AI lead score with rationale | Score plus contributing factors | Should | MVP |
| Key-point extraction | Pain points, objections, next steps | Should | P2 |
| Manual note override | Human agent can edit/append to AI notes | Should | MVP |
| CRM summary sync | Push summary to a connected CRM | Could | P2 |


# 10. Follow-ups & Tasks
| Feature | Description | Priority | Phase |
| Auto-created follow-ups | From qualifying call outcomes (e.g. demo scheduled) | Must | MVP |
| Manual task creation | Create and assign follow-ups manually | Must | MVP |
| Reminders & notifications | Alerts for upcoming follow-ups | Must | MVP |
| Calendar integration | Google/Outlook sync for demo scheduling | Should | P2 |
| Follow-up outcome tracking | Record what happened on the follow-up | Should | MVP |


# 11. Analytics & Reporting
| Feature | Description | Priority | Phase |
| Funnel analytics | Called → Talked → Interested → Demo → Converted | Must | MVP |
| Agent/AI-persona performance | Compare conversion rates across personas/agents | Should | MVP |
| Campaign ROI reporting | Cost per call vs conversions per campaign | Should | P2 |
| Scheduled digest emails | Daily/weekly performance summary | Should | P2 |
| Exportable reports | PDF/PPT export of dashboards | Could | P2 |
| Custom report builder | User-defined metrics and layouts | Could | P3 |


# 12. Team & Role Management
| Feature | Description | Priority | Phase |
| Role-based access control | Owner / Admin / Manager / Agent / Viewer | Must | MVP |
| Team invites | Invite members by email with a pre-set role | Must | MVP |
| Per-user activity log | Audit trail of user actions | Should | MVP |
| SSO / SAML | Enterprise single sign-on | Could | P3 |


# 13. Billing & Credits
| Feature | Description | Priority | Phase |
| Credit-based billing | “X calls left” balance model, matching the reference UI | Must | MVP |
| Plan tiers | Starter / Growth / Enterprise with feature gating | Must | MVP |
| In-app upgrade/downgrade | Self-serve plan changes | Must | MVP |
| Usage dashboard | Credits consumed vs remaining, burn rate | Must | MVP |
| Low-credit alerts & auto-recharge | Proactive notification and optional auto top-up | Should | MVP |
| Invoice history | Downloadable invoices | Should | MVP |
| Payment gateway integration | Razorpay / Stripe | Must | MVP |


# 14. Integrations & API
| Feature | Description | Priority | Phase |
| CRM integrations | Salesforce, HubSpot, Zoho | Should | P2 |
| Calendar integrations | Google Calendar, Outlook | Should | P2 |
| WhatsApp Business API | Automated follow-up messaging | Should | P2 |
| Public REST API | API-key authenticated access for tenants | Should | P2 |
| Outbound webhooks | Subscribe to key platform events | Should | P2 |
| Zapier / Make connector | No-code automation | Could | P3 |


# 15. White-Label & Branding
Per-tenant branding so each client workspace can look like its own product, the way the seed workspace is branded end-to-end in the reference design.
| Feature | Description | Priority | Phase |
| Custom logo & color theme | Per-workspace branding applied across the UI | Must | MVP |
| Custom subdomain | tenantname.appsgain.app | Should | MVP |
| White-labeled AI persona identity | Custom agent name/voice per tenant | Should | MVP |
| Custom domain mapping | Enterprise-tier fully custom domain | Could | P3 |


# 16. Compliance & Consent
| Feature | Description | Priority | Phase |
| DND/DLT registry check | Scrub numbers before dialing (India) | Must | MVP |
| Consent disclosure | Configurable recording/AI disclosure spoken on every call | Must | MVP |
| Retention policy configuration | Per-tenant recording/data retention rules | Must | MVP |
| Opt-out / do-not-call list | Tenant-managed suppression list | Must | MVP |
| Data subject access/erasure tooling | DPDP/GDPR request handling | Should | P2 |


# 17. Notifications
| Feature | Description | Priority | Phase |
| In-app notification center | Central feed of platform events | Must | MVP |
| Email notifications | Real-time alerts and digests | Must | MVP |
| Notification preferences | Per-user channel and frequency control | Should | MVP |
| SMS/WhatsApp alerts | Critical-event alerts outside the app | Could | P2 |


# 18. Super Admin / Platform Console
Appsgain-internal only — invisible to tenant workspaces.
| Feature | Description | Priority | Phase |
| Tenant provisioning & lifecycle | Create, suspend, delete workspaces | Must | MVP |
| Platform-wide analytics | Usage and revenue across all tenants | Must | MVP |
| Support impersonation | Log into a tenant workspace for support, fully audit-logged | Should | MVP |
| Feature-flag management | Enable/disable features per plan or tenant | Should | P2 |
| System health dashboard | Incident and uptime monitoring | Should | P2 |


# 19. Settings
| Feature | Description | Priority | Phase |
| Workspace profile | Company info, industry template selection | Must | MVP |
| Security settings | 2FA, session management | Must | MVP |
| Notification preferences | Workspace-level defaults | Must | MVP |
| API key management | Generate/revoke API keys | Should | P2 |
| Data export | Tenant-initiated data export (compliance) | Should | P2 |

