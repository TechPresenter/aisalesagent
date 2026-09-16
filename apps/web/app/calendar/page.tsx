import type { Metadata } from "next";
import { CalendarScreen } from "@/components/calendar/calendar-screen";

export const metadata: Metadata = { title: "Calendar · AI Sales Agent" };

/** Feature List §11 — Calendar. */
export default function CalendarPage() {
  return <CalendarScreen />;
}
