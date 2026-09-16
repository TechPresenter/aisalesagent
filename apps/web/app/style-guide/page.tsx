import { CheckCircle2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { Sparkline } from "@/components/ui/sparkline";
import { HandwritingText } from "@/components/ui/handwriting-text";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DonutChart, DonutLegend, type DonutSlice } from "@/components/ui/donut-chart";
import { TrendChart } from "@/components/ui/trend-chart";
import {
  CallOutcomeBadge,
  CallStatusBadge,
  LeadSourceBadge,
  LeadStatusBadge,
} from "@/components/ui/status-badge";
import {
  CALL_OUTCOME,
  CALL_STATUS,
  LEAD_SOURCE,
  LEAD_STATUS,
  TONE_HEX,
  type Tone,
} from "@/lib/status";
import { callOutcomes, callsTrend, leadSources, recentLeads } from "@/lib/mock-data";
import { formatDate } from "@/lib/utils";
import type { CallOutcome, CallStatus, Lead, LeadStatus } from "@/lib/types";

/**
 * Build Plan Phase 2 asks for a page that renders every component with sample data, so
 * the design system can be QA'd against the brand guidelines before real data is wired
 * in. Anything added to /components/ui belongs on this page too.
 */

const PRIMARY = [
  ["Brand Navy", "#0F2337", "Sidebar, headers, primary text"],
  ["Brand Green", "#19B969", "Primary buttons, positive trends"],
  ["Deep Green", "#0F6941", "Secondary dark surfaces"],
  ["Accent Blue", "#237DF5", "Links, info badges, chart series"],
  ["Accent Purple", "#7D55CD", "AI-generated content, AI Found"],
] as const;

const SEMANTIC = [
  ["Alert Red", "#F55F5F", "Not Interested, End Call"],
  ["Warning Amber", "#F5A623", "Wrong Number, low credits"],
  ["Neutral Gray", "#919BA5", "No Answer, disabled states"],
  ["Background", "#F5F5F5", "App canvas"],
  ["Surface White", "#FFFFFF", "Cards, panels, tables"],
] as const;

/**
 * The donut sections read their slice colours out of the same semantic tables the badges
 * use, so a QA pass can check "Interested is green in the badge row AND in the donut"
 * without either being restated here.
 */
const OUTCOME_SLICES: DonutSlice[] = callOutcomes.map(({ outcome, value }) => ({
  label: CALL_OUTCOME[outcome].label,
  value,
  color: TONE_HEX[CALL_OUTCOME[outcome].tone],
}));

const SOURCE_SLICES: DonutSlice[] = leadSources.map(({ source, value }) => ({
  label: LEAD_SOURCE[source].label,
  value,
  color: TONE_HEX[LEAD_SOURCE[source].tone],
}));

const sum = (slices: DonutSlice[]) => slices.reduce((total, s) => total + s.value, 0);

/** Demonstrates the generic table plus the badge-in-a-cell pattern §5 mandates. */
const LEAD_COLUMNS: Column<Lead>[] = [
  { key: "name", header: "Name / Clinic", className: "font-semibold", cell: (row) => row.name },
  {
    key: "phone",
    header: "Phone",
    className: "tabular text-slate-600",
    cell: (row) => row.phone,
  },
  { key: "city", header: "City", className: "text-slate-500", cell: (row) => row.city },
  { key: "source", header: "Source", cell: (row) => <LeadSourceBadge source={row.source} /> },
  { key: "status", header: "Status", cell: (row) => <LeadStatusBadge status={row.status} /> },
  {
    key: "added",
    header: "Added On",
    className: "tabular text-slate-500",
    cell: (row) => formatDate(row.addedOn),
  },
];

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>{title}</CardTitle>
        <p className="text-[12.5px] text-slate-500">{note}</p>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

export default function StyleGuidePage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-display text-brand-navy">Style Guide</h1>
        <p className="mt-1.5 text-[14px] text-slate-500">
          Every component in <code className="text-[13px] text-accent-purple">components/ui</code>,
          rendered against Brand Guidelines Part I. The two layout components —{" "}
          <code className="text-[13px] text-accent-purple">Sidebar</code> and{" "}
          <code className="text-[13px] text-accent-purple">TopHeader</code> — are QA&apos;d in
          place: they frame this page, so what you see around it is the specimen.
        </p>
      </div>

      <Section title="Color Palette" note="§3 — semantic names are the contract, never raw hex in a component.">
        <div className="space-y-6">
          {[
            ["Primary palette", PRIMARY],
            ["Semantic / status palette", SEMANTIC],
          ].map(([label, rows]) => (
            <div key={label as string}>
              <h3 className="mb-3 text-h3 text-brand-navy">{label as string}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {(rows as typeof PRIMARY).map(([name, hex, usage]) => (
                  <div key={name} className="min-w-0">
                    <div
                      className="h-14 rounded-lg border border-slate-200"
                      style={{ backgroundColor: hex }}
                    />
                    <p className="mt-2 text-[12.5px] font-semibold text-brand-navy">{name}</p>
                    <p className="tabular text-[11.5px] uppercase text-slate-400">{hex}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{usage}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography" note="§4 — Inter, with tabular figures on every number that updates live.">
        <div className="space-y-3">
          <p className="text-display text-brand-navy">Display / H1 — 32px / 700</p>
          <p className="text-h2 text-brand-navy">H2 — 24px / 700</p>
          <p className="text-h3 text-brand-navy">H3 — 18px / 600</p>
          <p className="tabular text-stat text-brand-navy">342 — Stat number, tabular</p>
          <p className="text-body text-slate-600">Body — 14px / 400. Table rows, transcripts.</p>
          <p className="text-caption text-slate-400">Small / Caption — 12px / 400.</p>
        </div>
      </Section>

      <Section title="Buttons" note="§5 — primary green, secondary white/navy, danger red.">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">End Call</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section
        title="Status Badges"
        note="§5 — a colour means one thing everywhere: green positive, blue informational, red negative, gray inactive, amber attention, purple AI."
      >
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">
              Lead status
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LEAD_STATUS) as LeadStatus[]).map((status) => (
                <LeadStatusBadge key={status} status={status} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">
              Call status
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CALL_STATUS) as CallStatus[]).map((status) => (
                <CallStatusBadge key={status} status={status} />
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">
              Call outcome &amp; lead source
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CALL_OUTCOME) as CallOutcome[]).map((outcome) => (
                <CallOutcomeBadge key={outcome} outcome={outcome} />
              ))}
              <LeadSourceBadge source="UPLOAD" />
              <LeadSourceBadge source="AI_FOUND" />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">
              Raw tones
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TONE_HEX) as Tone[]).map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Stat Cards & Sparklines" note="§5 — tinted icon circle, tabular number, trend arrow, inline sparkline.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Total Calls"
            value={342}
            trend={18}
            sparkline={[18, 24, 21, 30, 27, 34, 31, 42, 38, 46]}
            icon={PhoneCall}
            tone="blue"
          />
          <StatCard
            label="Interested"
            value={46}
            trend={27}
            sparkline={[2, 3, 3, 5, 4, 6, 5, 7, 6, 8]}
            icon={CheckCircle2}
            tone="green"
          />
          <StatCard
            label="Declining metric"
            value={180}
            trend={-12}
            sparkline={[46, 40, 42, 35, 33, 28, 30, 24, 22, 18]}
            icon={PhoneCall}
            tone="red"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          {(["green", "blue", "purple", "amber", "red", "gray"] as Tone[]).map((tone) => (
            <Sparkline
              key={tone}
              data={[4, 9, 6, 12, 8, 15, 11, 18]}
              color={TONE_HEX[tone]}
              width={88}
              height={32}
            />
          ))}
        </div>
      </Section>

      <Section
        title="DataTable"
        note="§5 — light-grey header row, 1px dividers, row hover, and the status column always a badge rather than plain text."
      >
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <DataTable
            columns={LEAD_COLUMNS}
            rows={recentLeads}
            rowKey={(row) => row.id}
          />
        </div>
        <p className="mt-4 mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-slate-400">
          Empty state
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <DataTable
            columns={LEAD_COLUMNS}
            rows={[]}
            rowKey={(row) => row.id}
            emptyMessage="No leads match these filters."
          />
        </div>
      </Section>

      <Section
        title="DonutChart"
        note="§5 — composition and breakdown. Slice colours are looked up in the semantic tables, so Interested is the same green here as on its badge."
      >
        <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
          <div className="flex items-center gap-5">
            <DonutChart
              data={OUTCOME_SLICES}
              centerValue={sum(OUTCOME_SLICES)}
              centerLabel="Total Calls"
            />
            <DonutLegend data={OUTCOME_SLICES} />
          </div>
          <div className="flex items-center gap-5">
            <DonutChart
              data={SOURCE_SLICES}
              centerValue={sum(SOURCE_SLICES)}
              centerLabel="Total Leads"
            />
            <DonutLegend data={SOURCE_SLICES} />
          </div>
        </div>
      </Section>

      <Section
        title="TrendChart"
        note="§5 — area chart with a soft gradient fill for change over time. Blue is the total series, green the interested series."
      >
        <TrendChart data={callsTrend} />
      </Section>

      <Section
        title="HandwritingText"
        note="Traces each glyph as a stroke, then inks it in. Degrades to plain text if the font or parser fails to load."
      >
        <div className="space-y-6">
          <p className="flex flex-wrap items-baseline gap-x-2 text-h2 text-brand-navy">
            Find. Call. Convert. Grow
            <HandwritingText
              words={["Northwind.", "your pipeline.", "every account.", "revenue."]}
              className="text-brand-green"
              height="1.15em"
            />
          </p>

          <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
            <div>
              <p className="mb-1.5 text-[11.5px] uppercase tracking-wide text-slate-400">
                Static, inked
              </p>
              <HandwritingText text="Converted" className="text-deep-green" height="2rem" />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] uppercase tracking-wide text-slate-400">
                Outline only
              </p>
              <HandwritingText
                text="Interested"
                fill={false}
                strokeWidth={2.2}
                className="text-accent-purple"
                height="2rem"
              />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] uppercase tracking-wide text-slate-400">
                Slow pen
              </p>
              <HandwritingText
                text="Demo Booked"
                duration={3.4}
                className="text-accent-blue"
                height="2rem"
              />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
