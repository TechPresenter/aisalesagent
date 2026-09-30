import { escapeHtml } from "../integrations/vendors/email";

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * The platform's emails. Plain words and one action each: every one of these arrives
 * unexpectedly, so the first line says why it was sent and the last says what to do if
 * the reader did not ask for it.
 */

function render(input: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  code?: string;
  footnote: string;
}): string {
  const font = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const body = input.paragraphs
    .map((paragraph) => `<p style="${font};font-size:15px;line-height:1.55;color:#1B2A41;margin:0 0 14px">${escapeHtml(paragraph)}</p>`)
    .join("");
  const code = input.code
    ? `<p style="${font};font-size:30px;font-weight:700;letter-spacing:8px;color:#1B2A41;margin:8px 0 18px">${escapeHtml(input.code)}</p>`
    : "";
  const action = input.action
    ? `<p style="margin:8px 0 18px"><a href="${escapeHtml(input.action.url)}" style="${font};display:inline-block;background:#237DF5;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:10px">${escapeHtml(input.action.label)}</a></p>` +
      `<p style="${font};font-size:12px;line-height:1.5;color:#919BA5;margin:0 0 14px">Or paste this link into your browser:<br>${escapeHtml(input.action.url)}</p>`
    : "";

  return (
    `<div style="background:#F4F6FA;padding:28px 12px"><div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:28px">` +
    `<p style="${font};font-size:13px;font-weight:700;color:#E5199B;margin:0 0 18px">Appsgain</p>` +
    `<h1 style="${font};font-size:21px;color:#1B2A41;margin:0 0 16px">${escapeHtml(input.heading)}</h1>` +
    body +
    code +
    action +
    `<p style="${font};font-size:12px;line-height:1.5;color:#919BA5;margin:18px 0 0;border-top:1px solid #EEF1F5;padding-top:14px">${escapeHtml(input.footnote)}</p>` +
    `</div></div>`
  );
}

export function passwordResetMail(input: {
  name: string;
  workspace: string;
  link: string;
  minutes: number;
}): MailContent {
  const footnote =
    "If you did not ask to reset your password, ignore this email — your password stays as it is.";
  return {
    subject: "Reset your Appsgain password",
    text:
      `Hi ${input.name},\n\nSomeone asked to reset the password for your account in the ${input.workspace} workspace. ` +
      `Use this link within ${input.minutes} minutes:\n\n${input.link}\n\nThe link works once.\n\n${footnote}`,
    html: render({
      heading: "Reset your password",
      paragraphs: [
        `Hi ${input.name},`,
        `Someone asked to reset the password for your account in the ${input.workspace} workspace. The link works once, within ${input.minutes} minutes.`,
      ],
      action: { label: "Choose a new password", url: input.link },
      footnote,
    }),
  };
}

export function verificationCodeMail(input: { name: string; code: string; minutes: number }): MailContent {
  const footnote = "If you did not create an Appsgain account, you can ignore this email.";
  return {
    subject: `${input.code} is your Appsgain verification code`,
    text:
      `Hi ${input.name},\n\nYour verification code is ${input.code}. It expires in ${input.minutes} minutes.\n\n${footnote}`,
    html: render({
      heading: "Confirm your email address",
      paragraphs: [`Hi ${input.name},`, `Enter this code in Appsgain. It expires in ${input.minutes} minutes.`],
      code: input.code,
      footnote,
    }),
  };
}

export function invitationMail(input: {
  workspace: string;
  inviter: string | null;
  role: string;
  link: string;
  days: number;
}): MailContent {
  const who = input.inviter ? `${input.inviter} has invited you` : "You have been invited";
  const role = input.role.charAt(0) + input.role.slice(1).toLowerCase();
  const footnote = `If you were not expecting this, ignore it — the invitation expires in ${input.days} days.`;
  return {
    subject: `Join ${input.workspace} on Appsgain`,
    text:
      `${who} to join ${input.workspace} on Appsgain as ${role}.\n\nAccept the invitation:\n\n${input.link}\n\n${footnote}`,
    html: render({
      heading: `Join ${input.workspace} on Appsgain`,
      paragraphs: [`${who} to join ${input.workspace} as ${role}.`],
      action: { label: "Accept invitation", url: input.link },
      footnote,
    }),
  };
}

export function securityNoticeMail(input: { name: string; event: string; detail: string }): MailContent {
  const footnote =
    "If this was not you, reset your password straight away and tell your workspace owner.";
  return {
    subject: `Security notice: ${input.event}`,
    text: `Hi ${input.name},\n\n${input.detail}\n\n${footnote}`,
    html: render({
      heading: input.event,
      paragraphs: [`Hi ${input.name},`, input.detail],
      footnote,
    }),
  };
}
