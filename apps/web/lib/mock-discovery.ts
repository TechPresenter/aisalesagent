import type { Tone } from "./status";

/** Feature List §3 — Find Leads (AI). */

export type DiscoverySource = "Google Maps" | "Justdial" | "Practo" | "Website" | "Directory";

/**
 * Directory sources take neutral and informational tones rather than the AI purple: the
 * *discovery* is AI-driven, but the source is just where the record was scraped from, and
 * colouring them all purple would say "these five things are AI" instead of telling them
 * apart.
 */
export const SOURCE_TONE: Record<DiscoverySource, Tone> = {
  "Google Maps": "blue",
  Justdial: "gray",
  Practo: "purple",
  Website: "blue",
  Directory: "amber",
};

export interface DiscoveredLead {
  id: string;
  name: string;
  contactPerson: string;
  specialty: string;
  city: string;
  phone: string;
  source: DiscoverySource;
  score: number;
}

export const discoveredLeads: DiscoveredLead[] = [
  { id: "d-1", name: "Apex Dental Care", contactPerson: "Dr. Sanjay Verma", specialty: "Dental", city: "Patna", phone: "+91 98765 43211", source: "Google Maps", score: 88 },
  { id: "d-2", name: "Health Plus Clinic", contactPerson: "Dr. Neha Singh", specialty: "General", city: "Gaya", phone: "+91 87654 32123", source: "Justdial", score: 76 },
  { id: "d-3", name: "City Medical Centre", contactPerson: "Dr. Amit Kumar", specialty: "Multi Speciality", city: "Patna", phone: "+91 76543 21234", source: "Google Maps", score: 62 },
  { id: "d-4", name: "LifeCare Clinic", contactPerson: "Dr. Priya Sinha", specialty: "Dental", city: "Ranchi", phone: "+91 65432 12345", source: "Practo", score: 91 },
  { id: "d-5", name: "MediLife Hospital", contactPerson: "Dr. Rajesh Mehta", specialty: "General", city: "Patna", phone: "+91 54321 23456", source: "Website", score: 58 },
  { id: "d-6", name: "Sharma Dental Clinic", contactPerson: "Dr. Pooja Sharma", specialty: "Dental", city: "Patna", phone: "+91 98765 43210", source: "Google Maps", score: 82 },
  { id: "d-7", name: "Smile Care Hospital", contactPerson: "Dr. Vikram Jha", specialty: "General", city: "Gaya", phone: "+91 91234 56789", source: "Justdial", score: 69 },
  { id: "d-8", name: "CityCare Multispeciality", contactPerson: "Dr. Alka Rani", specialty: "Multi Speciality", city: "Muzaffarpur", phone: "+91 99887 66554", source: "Directory", score: 74 },
  { id: "d-9", name: "Green Life Clinic", contactPerson: "Dr. Manoj Tiwari", specialty: "Dental", city: "Delhi", phone: "+91 88776 55443", source: "Google Maps", score: 67 },
  { id: "d-10", name: "Wellness Dental Care", contactPerson: "Dr. Kavita Rai", specialty: "Dental", city: "Noida", phone: "+91 77665 44332", source: "Website", score: 79 },
];

export const discoveryTotals = {
  clinicsFound: 12480,
  verifiedLeads: 8230,
  contactNumbers: 3560,
};

/** Lead Sources donut on the Find Leads screen. */
export const discoverySources = [
  { label: "Google Maps", value: 5242, percent: 42, tone: "blue" as const },
  { label: "Justdial", value: 2995, percent: 24, tone: "green" as const },
  { label: "Practo", value: 2246, percent: 18, tone: "purple" as const },
  { label: "Directories", value: 1248, percent: 10, tone: "amber" as const },
  { label: "Websites", value: 749, percent: 6, tone: "gray" as const },
];

export const popularSearches = [
  "Dental clinics in Patna",
  "Multi speciality hospitals in Bihar",
  "Skin & hair clinics in top 10 cities",
  "Clinics with 5+ doctors",
  "Physiotherapy clinics",
];
