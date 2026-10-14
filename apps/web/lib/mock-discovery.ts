import type { Tone } from "./status";

/**
 * Feature List §3 — Find Leads (AI). Sample rows for the preview of the discovery screen,
 * shown only when NEXT_PUBLIC_FEATURE_FIND_LEADS is on (config/features.ts).
 *
 * Three rules keep a sample from being mistaken for, or used as, real data:
 *
 *   - Every phone number is masked: country code and the last two digits only. A full
 *     number on a sample row is someone's number, published on a page anyone can open.
 *   - Sources are kinds of source, not named third-party sites. No data source is
 *     licensed yet, and naming one would claim a relationship that does not exist.
 *   - There are no totals. Counts of "leads found" over sample rows are numbers about
 *     nothing; the screen shows only what is in this list.
 */

export type DiscoverySource =
  "Business listing" | "Company website" | "Trade directory" | "Public registry";

/**
 * Sources take neutral and informational tones rather than the AI purple: the *discovery*
 * is AI-driven, but the source is just where a record would come from, and colouring them
 * all purple would say "these are all AI" instead of telling them apart.
 */
export const SOURCE_TONE: Record<DiscoverySource, Tone> = {
  "Business listing": "blue",
  "Company website": "green",
  "Trade directory": "amber",
  "Public registry": "gray",
};

export interface DiscoveredLead {
  id: string;
  name: string;
  contactPerson: string;
  industry: string;
  city: string;
  /** Always masked — see the rules above. */
  phone: string;
  source: DiscoverySource;
  score: number;
}

export const discoveredLeads: DiscoveredLead[] = [
  { id: "d-1", name: "Sample Logistics Co.", contactPerson: "Operations Head", industry: "Logistics", city: "Pune", phone: "+91 ••••• •••11", source: "Business listing", score: 88 },
  { id: "d-2", name: "Sample Realty Partners", contactPerson: "Sales Director", industry: "Real Estate", city: "Mumbai", phone: "+91 ••••• •••23", source: "Company website", score: 76 },
  { id: "d-3", name: "Sample Learning Academy", contactPerson: "Founder", industry: "Education", city: "Bengaluru", phone: "+91 ••••• •••34", source: "Trade directory", score: 62 },
  { id: "d-4", name: "Sample Software Labs", contactPerson: "Head of Growth", industry: "Software", city: "Hyderabad", phone: "+91 ••••• •••45", source: "Business listing", score: 91 },
  { id: "d-5", name: "Sample Auto Parts", contactPerson: "Purchase Manager", industry: "Automotive", city: "Chennai", phone: "+91 ••••• •••56", source: "Public registry", score: 58 },
  { id: "d-6", name: "Sample Finance Advisors", contactPerson: "Partner", industry: "Financial Services", city: "Delhi", phone: "+91 ••••• •••67", source: "Company website", score: 82 },
  { id: "d-7", name: "Sample Hotels Group", contactPerson: "General Manager", industry: "Hospitality", city: "Jaipur", phone: "+91 ••••• •••78", source: "Trade directory", score: 69 },
  { id: "d-8", name: "Sample Packaging Works", contactPerson: "Plant Manager", industry: "Manufacturing", city: "Ahmedabad", phone: "+91 ••••• •••89", source: "Public registry", score: 74 },
];

export const popularSearches = [
  "Logistics companies in Pune",
  "Software companies with 50+ employees",
  "Real estate developers in Mumbai",
  "Manufacturers exporting from Gujarat",
  "Training institutes in top 10 cities",
];
