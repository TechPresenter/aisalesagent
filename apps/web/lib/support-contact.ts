import { looksLikeEmail } from "@/lib/team-invites";

/**
 * The ways a customer can reach the vendor from inside the app — today the plans page's
 * Talk to Sales and Contact Us. Built from `appBrand.supportEmail` and `supportPhone`,
 * which are deploy-time settings and may be unset.
 *
 * Pure, so the rules are tested without a browser: a contact that is missing or malformed
 * yields no link at all. A button that opens a mail client addressed to nobody, or dials
 * half a number, is worse than no button.
 */
export interface ContactLink {
  kind: "email" | "phone";
  href: string;
  /** What the link says when it is shown as text: the address, or the number as written. */
  display: string;
}

/** `mailto:` with a subject, or null when there is no usable address. */
export function supportMailto(email: string | null | undefined, subject?: string): string | null {
  const to = email?.trim();
  if (!to || !looksLikeEmail(to)) return null;
  // RFC 6068: the address is percent-encoded like the rest, keeping the @ readable.
  const address = encodeURIComponent(to).replace(/%40/g, "@");
  return subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`;
}

/**
 * `tel:` from a number written for people: "+91 98765 43210" becomes tel:+919876543210.
 * A leading + is kept, everything else that is not a digit goes. Fewer than 6 digits, or
 * more than 15 (the E.164 maximum), is treated as a typo and gets no link.
 */
export function supportTel(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `tel:${raw.startsWith("+") ? "+" : ""}${digits}`;
}

/** Every usable contact, email first: writing is the channel support can answer later. */
export function supportContactLinks(
  contact: { email: string | null | undefined; phone: string | null | undefined },
  subject?: string,
): ContactLink[] {
  const links: ContactLink[] = [];
  const mailto = supportMailto(contact.email, subject);
  if (mailto) links.push({ kind: "email", href: mailto, display: contact.email!.trim() });
  const tel = supportTel(contact.phone);
  if (tel) links.push({ kind: "phone", href: tel, display: contact.phone!.trim() });
  return links;
}
