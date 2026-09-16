Complete Product Documentation
Appsgain AI Sales Agent — Master Specification v1.0
Brand Guidelines  ·  TRD  ·  Feature List  ·  Working Flow  ·  Claude Code Build Plan   |   September 2026

# Contents
| Part | Contents |
| I | Brand & Visual Identity — logo, color palette, typography, UI component style guide, voice & tone |
| II | Technical Requirements Document — architecture, tech stack, data model, APIs, non-functional requirements |
| III | Feature List — complete module-by-module feature specification with priority and phase |
| IV | Working Flow Specification — onboarding, lead, campaign, calling, and billing process flows with diagrams |
| V | Claude Code Build Plan — phased, ready-to-use prompts to build the platform step by step |

Each part below retains its own internal section numbering (1., 2., 3. …) under its Part heading, so this single file reads exactly like the four standalone documents, combined in build order.
PART I
Brand & Visual Identity
Logo, color palette, typography, and the UI component system

# 1. Brand Overview
Appsgain Technologies builds the Appsgain AI Sales Agent — a multi-tenant, industry-agnostic platform that lets any business deploy AI voice agents to find, call, qualify, and convert leads at scale. Appsgain runs the platform both as a SaaS product sold to client businesses and as its own internal outbound sales engine.

### Positioning statement
“Appsgain AI Sales Agent turns a list of leads into booked demos and closed deals — with an AI voice team that calls, listens, and follows up, so your human team only steps in where it matters.”

### Brand pillars
Intelligent — AI-first, but never a black box. Every call is transcribed, scored, and explainable.
Trustworthy — human oversight is always one click away (Listen Live, Barge-in, End Call).
Fast — real-time by default: live call status, live dashboards, live everything.
Adaptable — one platform, any industry, via configurable Industry Templates and white-label workspaces.

# 2. Logo
The Appsgain mark is a rounded-square lettermark in Brand Green, paired with the wordmark “Appsgain” in Brand Navy and a small tracked-caps product tag underneath.

### Primary lockup — for light backgrounds

### Reversed lockup — for dark backgrounds (sidebar, footers, dark UI)

### Icon mark alone — favicons, collapsed sidebar, app icon

### Clear space & minimum size
Keep clear space around the lockup at least equal to the height of the icon mark on every side.
Never scale the icon mark below 24×24px (app UI) or the full lockup below 120px wide (print/screen).

### Don'ts
Don't recolor the icon outside the approved palette.
Don't stretch, skew, or rotate the mark.
Don't add drop shadows, outlines, or effects.
Don't place the light lockup on backgrounds with insufficient contrast (below WCAG AA).

# 3. Color Palette
Palette extracted directly from the reference product UI and formalized as Appsgain's official brand and product colors.

### Primary palette
| Swatch | Name | Hex | Usage |
|  | Brand Navy | #0F2337 | Sidebar, headers, primary text on light bg |
|  | Brand Green | #19B969 | Primary buttons, positive trends, brand accent |
|  | Deep Green | #0F6941 | Secondary dark surfaces (e.g. Credits card) |
|  | Accent Blue | #237DF5 | Links, info badges, chart series, “Beta” tag |
|  | Accent Purple | #7D55CD | AI-generated content, “AI Found”, special features |


### Semantic / status palette
| Swatch | Name | Hex | Usage |
|  | Alert Red | #F55F5F | Not Interested, End Call, destructive actions |
|  | Warning Amber | #F5A623 | Wrong Number, low-credit warnings |
|  | Neutral Gray | #919BA5 | No Answer, inactive/disabled states |
|  | Background | #F5F5F5 | App canvas background |
|  | Surface White | #FFFFFF | Cards, panels, tables |

Accessibility: body text uses Brand Navy on white (contrast ratio > 12:1). White text is only placed on Brand Navy, Brand Green, Deep Green, Accent Blue, Accent Purple, Alert Red or Amber — never on tints lighter than 50% — to keep all UI text at WCAG AA or better.

# 4. Typography
Primary typeface: Inter (system fallback stack: -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif). Inter is used across the dashboard, marketing site, and generated PDF reports for a single consistent voice.
| Style | Size / Weight | Usage |
| Display / H1 | 32px / 700 | Page titles (e.g. “AI Sales Agent”) |
| H2 | 24px / 700 | Section headers, card titles |
| H3 | 18px / 600 | Sub-section labels, table headers |
| Stat Number | 32px / 700, tabular figures | KPI card numbers (342, 128, 46…) |
| Body | 14px / 400 | Table rows, descriptions, transcripts |
| Small / Caption | 12px / 400 | Timestamps, helper text, badge labels |

Tabular (monospaced-width) figures are required for all stat-card numbers and tables so digits align vertically when values update in real time.

# 5. UI Component Style Guide

### Layout
Sidebar: fixed 240px, Brand Navy background, white/70%-white nav text, active item shown with a Brand Green left-edge accent bar plus a subtly lighter navy background.
Header bar: 72px, white background, global search, live-agent status pill, notifications, account menu.
Content canvas: Background gray (#F5F5F5), 24px page padding, 12-column responsive grid.

### Cards
White surface, 12–16px corner radius, subtle shadow (0 1px 3px rgba(0,0,0,0.06)), 20–24px internal padding.
Stat cards: icon in a light-tint circle (colored icon on 12% tint of its semantic color) + bold stat number + label + colored trend arrow/% + inline sparkline.

### Buttons
Primary — Brand Green fill, white text, 8–10px radius (e.g. “+ New Campaign”).
Secondary — white fill, Navy border and text.
Danger — Alert Red fill, white text (e.g. “End Call”).

### Status badges
Pill-shaped, light-tint background (12–15% of the semantic color) with the solid color as text — e.g. light-green pill + dark-green text for “Interested.”
Color mapping is fixed and never reused for a different meaning: green = positive/interested, blue = informational/follow-up, red = negative, gray = inactive/no answer, amber = needs attention/wrong number, purple = AI-related.

### Tables
White background, light-gray header row, 1px row dividers, row-hover highlight, status column always rendered as a badge, never plain text.

### Charts
Donut charts for composition/breakdown (Call Outcomes, Lead Sources).
Line/area charts with soft gradient fill for trends over time (Calls Trend).
Chart colors always match the semantic palette so a color means the same thing in every chart on the page.

# 6. Iconography
Outline/line-style icons, 1.5–2px stroke, rounded line caps, drawn on a 24×24 grid (compatible with icon sets such as Lucide).
Icons are always paired with the semantic color system — never a decorative color unrelated to meaning.

# 7. Voice & Tone

### Product / UI copy
Clear, confident, plain language. Action-first labels (“New Campaign,” not “Create a New Campaign Now”).
Never overstate AI capability — always show the human-oversight controls alongside AI actions.

### AI Voice Agent conversational tone
Default: warm, respectful, concise, and honest about being an AI agent when asked.
Tone, language, and script are configurable per workspace and per Industry Template, but every persona must disclose it is calling from the tenant's business and state the purpose of the call within the opening turn.

# 8. Do's and Don'ts
| Area | Do | Don't |
| Logo | Use the provided lockup files at approved sizes | Recreate, redraw, or recolor the mark |
| Color | Use semantic colors consistently across charts, badges, and buttons | Introduce new accent colors outside the approved palette |
| Type | Use Inter with tabular figures for numbers | Mix in decorative or condensed fonts for data |
| Tone | Disclose the AI agent's identity and purpose on every call | Let the AI agent imply it is a human unless asked directly |

PART II
Technical Requirements Document
Architecture, tech stack, data model, APIs, and non-functional requirements

