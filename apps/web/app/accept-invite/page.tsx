import type { Metadata } from "next";
import { AcceptInviteScreen } from "@/components/auth/recovery-forms";

export const metadata: Metadata = { title: "Join Your Team · Appsgain" };

/** Feature List §12 — accepting a team invitation. `?token=` comes from the emailed link. */
export default function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
  return <AcceptInviteScreen token={token ?? ""} />;
}
