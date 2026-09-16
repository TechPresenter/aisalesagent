import { Badge } from "@/components/ui/badge";
import { CALL_OUTCOME, CALL_STATUS, LEAD_SOURCE, LEAD_STATUS } from "@/lib/status";
import type { CallOutcome, CallStatus, LeadSource, LeadStatus } from "@/lib/types";

/**
 * Brand Guidelines §5 (Tables): "status column always rendered as a badge, never plain
 * text." Each variant looks its label and tone up in the one semantic table, so a status
 * can never drift into the wrong colour in one place and not another.
 */
export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const { label, tone } = LEAD_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function CallStatusBadge({ status }: { status: CallStatus }) {
  const { label, tone } = CALL_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function CallOutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  const { label, tone } = CALL_OUTCOME[outcome];
  return <Badge tone={tone}>{label}</Badge>;
}

export function LeadSourceBadge({ source }: { source: LeadSource }) {
  const { label, tone } = LEAD_SOURCE[source];
  return <Badge tone={tone}>{label}</Badge>;
}
