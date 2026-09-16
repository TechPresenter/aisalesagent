import type { CallStatus, TranscriptTurn } from "./types";

/**
 * Seed data for Call History, Recordings and AI Calling. One module rather than three
 * because they are three views of the same rows — a recording is a call that connected,
 * and the live console is the calls that have not finished yet. Splitting them would let
 * the same call show a different duration on two screens.
 */

export interface AgentRef {
  name: string;
  language: string;
  initial: string;
  /** Tone token for the avatar tint, so an agent is the same colour on every screen. */
  tone: "purple" | "blue" | "green" | "amber";
}

export const AGENTS: Record<string, AgentRef> = {
  anjali: { name: "Anjali", language: "Hindi", initial: "A", tone: "blue" },
  rohan: { name: "Rohan", language: "Hindi", initial: "R", tone: "amber" },
  priya: { name: "Priya", language: "Hindi", initial: "P", tone: "purple" },
};

/** Call History rows carry a superset of what any one screen shows. */
export interface CallRecord {
  id: string;
  startedAt: string;
  phone: string;
  clinicName: string;
  city: string;
  agent: AgentRef;
  /** Seconds. */
  duration: number;
  status: CallStatus | "CONNECTED" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED" | "MISSED";
  campaign: string;
  hasRecording: boolean;
  /** Bytes, for the Recordings storage figure. */
  sizeBytes: number;
  transcript: TranscriptTurn[];
  notes: string;
  tags: string[];
}

/**
 * The reference transcript, reused across rows. Real transcripts differ per call; this
 * is seed data, and one well-formed bilingual example demonstrates the rendering better
 * than ten thin ones.
 */
const REFERENCE_TRANSCRIPT: TranscriptTurn[] = [
  {
    speaker: "AI",
    text: "Namaste sir, main Northwind Solutions se Anjali bol rahi hoon. Kya abhi 2 minute baat kar sakte hain?",
  },
  { speaker: "CLIENT", text: "Haan boliye." },
  {
    speaker: "AI",
    text: "Hum dental clinics ke liye appointment, patient management aur billing software provide karte hain. Aapke clinic mein abhi ye sab kaise manage hota hai?",
  },
  { speaker: "CLIENT", text: "Abhi hum register mein manage karte hain." },
  {
    speaker: "AI",
    text: "Samajh gayi. Kya main aapke liye 5 minute ka demo schedule kar sakti hoon?",
  },
  { speaker: "CLIENT", text: "Haan, kal 11 baje kar do." },
];

interface CallSeed {
  date: string;
  time: string;
  phone: string;
  clinic: string;
  city: string;
  agent: AgentRef;
  duration: number;
  status: CallRecord["status"];
  campaign: string;
}

/** The ten rows the Call History and Recordings screens show, in their order. */
const CALL_SEED: CallSeed[] = [
  { date: "2025-05-31", time: "11:24", phone: "+91 98765 43210", clinic: "Sharma Dental Clinic", city: "Patna", agent: AGENTS.anjali, duration: 84, status: "CONNECTED", campaign: "Dental Clinics - Bihar" },
  { date: "2025-05-31", time: "10:42", phone: "+91 87654 32109", clinic: "City Care Clinic", city: "Gaya", agent: AGENTS.rohan, duration: 52, status: "CONNECTED", campaign: "Bihar Clinics - May" },
  { date: "2025-05-31", time: "10:15", phone: "+91 76543 21098", clinic: "LifeLine Clinic", city: "Ranchi", agent: AGENTS.anjali, duration: 16, status: "NO_ANSWER", campaign: "Jharkhand Expansion" },
  { date: "2025-05-31", time: "09:48", phone: "+91 65432 10987", clinic: "Singh Medical Store", city: "Patna", agent: AGENTS.rohan, duration: 0, status: "MISSED", campaign: "Bihar Clinics - May" },
  { date: "2025-05-31", time: "09:30", phone: "+91 54321 09876", clinic: "Health Point", city: "Gaya", agent: AGENTS.anjali, duration: 131, status: "CONNECTED", campaign: "Bihar Clinics - May" },
  { date: "2025-05-30", time: "18:20", phone: "+91 91234 56789", clinic: "Smile Care Hospital", city: "Gaya", agent: AGENTS.priya, duration: 68, status: "FOLLOW_UP", campaign: "Dental Clinics - Bihar" },
  { date: "2025-05-30", time: "17:45", phone: "+91 99887 66554", clinic: "CityCare Multispeciality", city: "Muzaffarpur", agent: AGENTS.anjali, duration: 37, status: "NOT_INTERESTED", campaign: "Bihar Clinics - May" },
  { date: "2025-05-30", time: "16:12", phone: "+91 88776 55443", clinic: "Green Life Clinic", city: "Delhi", agent: AGENTS.rohan, duration: 116, status: "INTERESTED", campaign: "Metro Clinics - Q2" },
  { date: "2025-05-30", time: "15:28", phone: "+91 77665 44332", clinic: "Wellness Dental Care", city: "Noida", agent: AGENTS.anjali, duration: 194, status: "CONNECTED", campaign: "Metro Clinics - Q2" },
  { date: "2025-05-29", time: "14:10", phone: "+91 98764 33221", clinic: "Apex Dental Care", city: "Patna", agent: AGENTS.rohan, duration: 45, status: "BUSY", campaign: "Dental Clinics - Bihar" },
];

const NOTES_BY_STATUS: Record<string, string> = {
  CONNECTED:
    "Client is interested in demo. Wants to know more about pricing and features. Follow up tomorrow at 11:00 AM.",
  INTERESTED:
    "Positive call. Asked for a written proposal and a demo with their partner doctor.",
  FOLLOW_UP: "Reached the front desk. Owner available after 6 PM — call back then.",
  NOT_INTERESTED: "Already on another system and under contract until next year.",
  NO_ANSWER: "No answer. Requeued for retry per campaign rules.",
  MISSED: "Call could not connect to the carrier.",
  BUSY: "Line busy. Requeued.",
};

export const calls: CallRecord[] = CALL_SEED.map((seed, index) => ({
  id: `call-${index + 1}`,
  startedAt: `${seed.date}T${seed.time}:00`,
  phone: seed.phone,
  clinicName: seed.clinic,
  city: seed.city,
  agent: seed.agent,
  duration: seed.duration,
  status: seed.status,
  campaign: seed.campaign,
  hasRecording: seed.duration > 0,
  // ~13 KB/s at the codec the telephony provider records with; enough for the storage
  // figure to move with the durations rather than being a made-up constant.
  sizeBytes: seed.duration * 13_000,
  transcript: seed.duration > 30 ? REFERENCE_TRANSCRIPT : REFERENCE_TRANSCRIPT.slice(0, 2),
  notes: NOTES_BY_STATUS[seed.status] ?? "",
  tags: ["Dental Software", "Interested", "Follow-up", "Demo Scheduled"],
}));

/** Live console — calls in flight right now. */
export interface LiveCallRow {
  id: string;
  phone: string;
  clinicName: string;
  city: string;
  duration: number;
  status: CallStatus;
  agent: AgentRef;
}

export const liveCalls: LiveCallRow[] = [
  { id: "live-1", phone: "+91 98765 43210", clinicName: "Sharma Dental Clinic", city: "Patna", duration: 84, status: "CONNECTED", agent: AGENTS.anjali },
  { id: "live-2", phone: "+91 87654 32109", clinicName: "City Care Clinic", city: "Gaya", duration: 52, status: "CONNECTED", agent: AGENTS.rohan },
  { id: "live-3", phone: "+91 76543 21098", clinicName: "LifeLine Clinic", city: "Ranchi", duration: 16, status: "RINGING", agent: AGENTS.anjali },
  { id: "live-4", phone: "+91 65432 10987", clinicName: "Singh Medical Store", city: "Patna", duration: 0, status: "DIALING", agent: AGENTS.rohan },
  { id: "live-5", phone: "+91 54321 09876", clinicName: "Health Point", city: "Gaya", duration: 131, status: "CONNECTED", agent: AGENTS.anjali },
];

export interface QueuedCall {
  id: string;
  phone: string;
  clinicName: string;
  city: string;
  scheduledFor: string;
}

export const queuedCalls: QueuedCall[] = [
  { id: "q-1", phone: "+91 91234 56789", clinicName: "Smile Care Hospital", city: "Gaya", scheduledFor: "Today, 02:00 PM" },
  { id: "q-2", phone: "+91 99887 66554", clinicName: "CityCare Multispeciality", city: "Muzaffarpur", scheduledFor: "Today, 02:15 PM" },
  { id: "q-3", phone: "+91 88776 55443", clinicName: "Green Life Clinic", city: "Delhi", scheduledFor: "Today, 02:30 PM" },
  { id: "q-4", phone: "+91 77665 44332", clinicName: "Wellness Dental Care", city: "Noida", scheduledFor: "Today, 02:45 PM" },
  { id: "q-5", phone: "+91 98764 33221", clinicName: "Apex Dental Care", city: "Patna", scheduledFor: "Today, 03:00 PM" },
];

/** Totals shown on the KPI strips. Period aggregates, not counts of the rows above. */
export const callTotals = {
  totalCalls: 342,
  connected: 128,
  interested: 46,
  missed: 22,
  avgDuration: "02:14",
  totalRecordings: 342,
  storageUsed: "2.4 GB",
  liveInProgress: 12,
  queued: 28,
};

/** AI Calling — Call Status donut. */
export const callStatusBreakdown = [
  { label: "Connected", value: 128, tone: "green" as const },
  { label: "Interested", value: 46, tone: "blue" as const },
  { label: "Follow-up", value: 38, tone: "purple" as const },
  { label: "Not Interested", value: 90, tone: "red" as const },
  { label: "No Answer", value: 22, tone: "amber" as const },
  { label: "Busy", value: 18, tone: "gray" as const },
];
