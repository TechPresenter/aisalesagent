Working Flow Specification
Appsgain AI Sales Agent — Process & User Flows
Prepared for Appsgain Technologies  ·  September 2026

# Overview
This document specifies the end-to-end process flows behind the Appsgain AI Sales Agent: how a workspace is set up, how a lead enters the system, how an AI call actually runs turn by turn, and how outcomes propagate to follow-ups, the dashboard, and billing. It complements the TRD (system design) and Feature List (what is built) with how each part behaves in sequence.

# Actors
| Actor | Role in the flows |
| Appsgain Super Admin | Provisions and supports tenant workspaces |
| Workspace Owner / Admin | Configures the workspace, team, and compliance settings |
| Sales Manager | Builds and launches campaigns, monitors live calls |
| Sales Agent | Works assigned leads and follow-ups |
| AI Voice Agent | Executes the call script and conversation loop |
| Prospect / Lead | Receives the call — external to the platform |
| Telephony / AI Providers | External systems: call carrier, LLM, STT/TTS |


# Flow 1 — Tenant / Workspace Onboarding
Prospective client signs up (self-serve or via Appsgain sales) and selects a plan.
A workspace is created (tenant_id generated) with a Workspace Owner account.
Owner completes the setup wizard: company name, industry template, branding (logo/colors), timezone.
Owner invites team members and assigns roles (Admin, Manager, Agent).
Owner connects a phone number/telephony account, or is assigned an Appsgain-provided number.
Owner uploads an initial lead list or configures AI Lead-Find criteria.
Owner configures the default AI Agent persona: name, voice, language, and script template for their industry.
Compliance setup: DND/DLT scrubbing enabled, consent-disclosure text confirmed, retention policy set.
First campaign is created and launched (or scheduled).
Workspace status becomes Active; usage begins consuming plan credits.

# Flow 2 — Lead Acquisition

### Path A — Manual upload
User uploads a CSV/XLSX file.
System maps columns to lead fields and flags errors (bad phone formats, missing required fields).
System de-duplicates against existing leads.
Valid leads are added with source = “Your Upload.”

### Path B — AI Found
User sets discovery criteria: industry, location, company size, keywords.
AI searches and compiles candidate leads matching the criteria.
User reviews the candidate list and approves leads for import.
Approved leads are added with source = “AI Found.”
Both paths converge: new leads receive an initial AI score and become available for campaign assignment.

# Flow 3 — Campaign Creation & Launch
Sales Manager creates a campaign and names its objective.
Manager selects the target lead segment (filters or an explicit list).
Manager selects/customizes the AI script and chooses the voice/language persona.
Manager sets the schedule: calling window, days, timezone, start/end date.
System runs a pre-launch compliance check (DND/DLT scrub, consent flag) and blocks launch on failure.
Manager reviews the campaign summary and launches (or schedules it for later).
The campaign's leads enter the dialer queue.

# Flow 4 — AI Calling Flow (core)
This is the heart of the product — the same sequence the reference dashboard's “12 calls in progress” view is built on.
Figure 1 — AI Calling Flow
| Step | System / Dialer | AI Voice Agent | Dashboard |
| 1 | Selects next lead from the queue, respecting call-window & DND rules | — | Live Calls count updates |
| 2 | Places the call → Dialing → Ringing | — | Row appears with status “Dialing” → “Ringing” |
| 3 | Connects the call on pickup | Greets, states purpose & AI disclosure | Status changes to “Talking” |
| 4 | Streams audio both ways | STT → LLM reasoning (script + objections) → TTS, on a loop | Waveform + live-call panel active |
| 5 | Available at any time | Continues conversation until natural close or hang-up | Manager can Listen Live / Barge-in / End Call |
| 6 | Detects call end | — | Row leaves the Live Calls table |
| 7 | Triggers post-call processing | Classifies outcome (Interested/Follow-up/Not Interested/No Answer/Wrong Number) | Call Outcomes chart updates |
| 8 | Stores results | Generates transcript, summary, and lead score | Recent Leads & AI Sales Notes panel update |
| 9 | Creates follow-up if applicable | — | Follow-up task appears for the assigned agent |


# Flow 5 — Follow-up & Conversion
A follow-up task is created automatically from a qualifying call outcome, or manually by an agent.
The task is assigned to a human agent or queued as an AI re-call.
A reminder fires at the task's due date/time.
The agent (or AI) performs the follow-up action — a call-back, a demo confirmation, etc.
Lead status updates accordingly (e.g. Demo Booked → Converted, or recycled for another attempt).
On conversion, the lead is marked closed-won and attributed to its originating campaign for ROI reporting.

# Flow 6 — Lead Status State Machine
Figure 2 — Lead status states and transitions
| State | Meaning | Typical next states |
| New Lead | Added to the system, not yet called | Contacted |
| Contacted | At least one call attempt made | Interested, Follow-up, Not Interested, No Answer, Wrong Number |
| Interested / Follow-up | Positive outcome, needs next step | Demo Booked |
| Not Interested / No Answer / Wrong Number | Negative or inconclusive outcome | Closed / Recycled for Retry |
| Demo Booked | A demo or next call is scheduled | Converted |
| Converted | Deal closed | — (terminal) |
| Closed / Recycled for Retry | Either closed out or queued for another attempt later | Contacted (on retry) |


# Flow 7 — Call Status State Machine
| State | Trigger | Next possible states |
| Queued | Lead selected by the dialer | Dialing |
| Dialing | Call initiated to the carrier | Ringing, Failed |
| Ringing | Carrier confirms ringing on the destination | Talking, No Answer, Busy |
| Talking | Prospect answers | Completed |
| Completed | Call ends (either party) | — (feeds outcome classification) |
| Failed / Busy / No Answer | Call could not connect or complete | Requeued per campaign retry rules |


# Flow 8 — Notification Flow
A platform event occurs (e.g. call outcome = Interested, credit balance low, campaign completed).
The Notification service checks each affected user's channel preferences.
Notifications dispatch via the enabled channels: in-app, email, and/or SMS/WhatsApp.
Every notification is logged in the Notification Center regardless of delivery channel.

# Flow 9 — Billing / Credit Consumption
A call completes.
Duration and call type determine the credit cost.
A CreditLedger entry is created and the tenant's balance is decremented.
If the balance drops below the configured threshold, a low-credit alert is triggered.
If auto-recharge is enabled, a top-up payment is initiated automatically; otherwise the Owner is prompted to recharge manually.
