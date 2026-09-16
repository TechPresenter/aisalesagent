import type { CallOutcome, KpiStat, Lead, LiveCall, SalesNote } from "./types";

/**
 * Seed data for the dashboard. Build Plan Phase 3 is layout-and-fidelity only; Phase 9
 * replaces this module with GET /analytics/dashboard. Every shape here already matches
 * the response that endpoint is specified to return, so the swap is one import away.
 */

export const kpiStats: KpiStat[] = [
  { id: "total-calls", label: "Total Calls", value: 342, trend: 18, sparkline: [18, 24, 21, 30, 27, 34, 31, 42, 38, 46, 44, 52] },
  { id: "talked", label: "Talked", value: 128, trend: undefined, sparkline: [8, 11, 9, 14, 12, 16, 15, 19, 17, 21, 20, 24] },
  { id: "interested", label: "Interested", value: 46, trend: 27, sparkline: [2, 3, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9] },
  { id: "demo-booked", label: "Demo Booked", value: 22, trend: 46, sparkline: [1, 1, 2, 2, 3, 2, 3, 4, 3, 5, 4, 6] },
  { id: "ai-leads", label: "Leads Found by AI", value: 254, trend: 33, sparkline: [10, 14, 18, 16, 22, 26, 24, 30, 34, 32, 40, 46] },
];

export const callOutcomes: { outcome: CallOutcome; value: number }[] = [
  { outcome: "INTERESTED", value: 46 },
  { outcome: "FOLLOW_UP", value: 38 },
  { outcome: "NOT_INTERESTED", value: 180 },
  { outcome: "NO_ANSWER", value: 56 },
  { outcome: "WRONG_NUMBER", value: 22 },
];

export const leadSources = [
  { source: "UPLOAD" as const, value: 358 },
  { source: "AI_FOUND" as const, value: 254 },
];

/** Daily series for the Calls Trend chart — May 1 to May 31. */
export const callsTrend = [
  { date: "May 1", total: 6, interested: 1 },
  { date: "May 2", total: 12, interested: 2 },
  { date: "May 3", total: 9, interested: 1 },
  { date: "May 4", total: 18, interested: 3 },
  { date: "May 5", total: 15, interested: 2 },
  { date: "May 6", total: 24, interested: 5 },
  { date: "May 7", total: 21, interested: 4 },
  { date: "May 8", total: 30, interested: 7 },
  { date: "May 9", total: 27, interested: 5 },
  { date: "May 10", total: 38, interested: 9 },
  { date: "May 11", total: 34, interested: 8 },
  { date: "May 12", total: 46, interested: 11 },
  { date: "May 13", total: 52, interested: 13 },
  { date: "May 14", total: 61, interested: 15 },
  { date: "May 15", total: 57, interested: 14 },
  { date: "May 16", total: 49, interested: 12 },
  { date: "May 17", total: 44, interested: 10 },
  { date: "May 18", total: 51, interested: 13 },
  { date: "May 19", total: 47, interested: 11 },
  { date: "May 20", total: 55, interested: 14 },
  { date: "May 21", total: 62, interested: 16 },
  { date: "May 22", total: 58, interested: 15 },
  { date: "May 23", total: 66, interested: 18 },
  { date: "May 24", total: 71, interested: 19 },
  { date: "May 25", total: 64, interested: 17 },
  { date: "May 26", total: 59, interested: 15 },
  { date: "May 27", total: 68, interested: 18 },
  { date: "May 28", total: 74, interested: 21 },
  { date: "May 29", total: 70, interested: 19 },
  { date: "May 30", total: 63, interested: 17 },
  { date: "May 31", total: 57, interested: 16 },
];

const anjali = {
  id: "persona-anjali",
  name: "Anjali",
  language: "Hindi",
  avatarUrl:
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=faces&q=80",
};

const rohan = {
  id: "persona-rohan",
  name: "Rohan",
  language: "Hindi",
  avatarUrl:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=faces&q=80",
};

export const liveCalls: LiveCall[] = [
  { id: "call-1", phone: "+91 98765 43210", clinicName: "Sharma Dental Clinic", city: "Patna", duration: 84, status: "CONNECTED", persona: anjali },
  { id: "call-2", phone: "+91 87654 32109", clinicName: "City Care Clinic", city: "Gaya", duration: 52, status: "CONNECTED", persona: rohan },
  { id: "call-3", phone: "+91 76543 21098", clinicName: "LifeLine Clinic", city: "Ranchi", duration: 16, status: "RINGING", persona: anjali },
  { id: "call-4", phone: "+91 65432 10987", clinicName: "Singh Medical Store", city: "Patna", duration: 0, status: "DIALING", persona: rohan },
  { id: "call-5", phone: "+91 54321 09876", clinicName: "Health Point", city: "Gaya", duration: 131, status: "CONNECTED", persona: anjali },
];

/** Header badge and the Live Calls card title both read from this. */
export const callsInProgress = 12;

export const recentLeads: Lead[] = [
  { id: "lead-1", name: "Apex Dental Care", phone: "+91 98765 43211", city: "Patna", source: "AI_FOUND", status: "INTERESTED", score: 82, addedOn: "2025-05-31" },
  { id: "lead-2", name: "Health Plus Clinic", phone: "+91 87654 32123", city: "Gaya", source: "UPLOAD", status: "FOLLOW_UP", score: 64, addedOn: "2025-05-31" },
  { id: "lead-3", name: "City Medical Centre", phone: "+91 76543 21234", city: "Patna", source: "AI_FOUND", status: "NOT_INTERESTED", score: 21, addedOn: "2025-05-30" },
  { id: "lead-4", name: "LifeCare Clinic", phone: "+91 65432 12345", city: "Ranchi", source: "AI_FOUND", status: "DEMO_BOOKED", score: 91, addedOn: "2025-05-30" },
  { id: "lead-5", name: "MediLife Hospital", phone: "+91 54321 23456", city: "Patna", source: "UPLOAD", status: "INTERESTED", score: 77, addedOn: "2025-05-29" },
];

export const latestSalesNote: SalesNote = {
  callId: "call-1",
  leadName: "Sharma Dental Clinic",
  timestamp: "May 31, 2025  11:24 AM",
  turns: [
    { speaker: "AI", text: "Namaste sir, main Northwind Solutions se Anjali bol rahi hoon. Kya abhi 2 minute baat kar sakte hain?" },
    { speaker: "CLIENT", text: "Haan boliye." },
    { speaker: "AI", text: "Hum clinics ke liye appointment, patient management aur billing software provide karte hain..." },
    { speaker: "CLIENT", text: "Achha, abhi hum register mein manage karte hain." },
    { speaker: "AI", text: "Samajh gayi. Kya main aapke liye 5 minute ka demo schedule kar sakti hoon?" },
    { speaker: "CLIENT", text: "Haan, kal 11 baje kar do." },
  ],
  summary:
    "Clinic manual register use karta hai. Interested in appointment and billing. Demo scheduled for tomorrow at 11:00 AM.",
  leadScore: 85,
};

/** Feature List §13 — the sidebar Credits card. */
export const creditBalance = { remaining: 1250, total: 2000 };
