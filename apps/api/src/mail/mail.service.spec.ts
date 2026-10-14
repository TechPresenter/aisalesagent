import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { reportMessage } from "../common/error-reporting";
import { invitationMail, passwordResetMail, securityNoticeMail, verificationCodeMail } from "./mail-templates";
import { MailService, type OutgoingMail } from "./mail.service";

jest.mock("../common/error-reporting", () => ({ reportMessage: jest.fn() }));

const CODE = "482913";
const API_KEY = "xkeysib-0123456789abcdef-secret";

function serviceWith(values: Record<string, string | undefined>): MailService {
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new MailService(config);
}

function verification(): OutgoingMail {
  return { to: "priya.sharma@example.com", ...verificationCodeMail({ name: "Priya", code: CODE, minutes: 10 }) };
}

/** Every line the service logged, at every level, as one string. */
function logged(spies: jest.SpyInstance[]): string {
  return spies.flatMap((spy) => spy.mock.calls.map((call) => call.join(" "))).join("\n");
}

describe("MailService", () => {
  let fetchMock: jest.SpyInstance;
  let logSpies: jest.SpyInstance[];

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch");
    logSpies = (["log", "warn", "error"] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(reportMessage).mockReset();
  });

  describe("status", () => {
    it("accepts Brevo, as it does SendGrid and Resend, once a key and sender are set", () => {
      for (const driver of ["brevo", "sendgrid", "resend", " Brevo "]) {
        expect(
          serviceWith({ MAIL_DRIVER: driver, MAIL_API_KEY: API_KEY, MAIL_FROM: "no-reply@notify.appsgain.in" }).status(),
        ).toEqual({ driver: driver.trim().toLowerCase(), deliverable: true, devLog: false, reason: undefined });
      }
    });

    it("says what is missing when Brevo has no key or sender", () => {
      expect(serviceWith({ MAIL_DRIVER: "brevo", MAIL_FROM: "no-reply@notify.appsgain.in" }).status()).toEqual({
        driver: "brevo",
        deliverable: false,
        devLog: false,
        reason: "MAIL_API_KEY and MAIL_FROM must both be set",
      });
    });

    it("still refuses an unknown driver, and the log driver in production", () => {
      expect(serviceWith({ MAIL_DRIVER: "mailgun" }).status()).toMatchObject({
        deliverable: false,
        reason: 'MAIL_DRIVER "mailgun" is not supported',
      });
      expect(serviceWith({ MAIL_DRIVER: "log", NODE_ENV: "production" }).status()).toMatchObject({
        driver: "none",
        deliverable: false,
      });
    });
  });

  describe("sending through Brevo", () => {
    const brevo = {
      MAIL_DRIVER: "brevo",
      MAIL_API_KEY: API_KEY,
      MAIL_FROM: "no-reply@notify.appsgain.in",
      MAIL_FROM_NAME: "Appsgain",
      NODE_ENV: "production",
    };

    it("posts to Brevo's transactional endpoint with its api-key header", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ messageId: "<1@smtp-relay.mailin.fr>" }), { status: 201 }));
      const mail = { to: "neha@example.com", ...passwordResetMail({ name: "Neha", workspace: "Northwind", link: "https://app/reset?token=t", minutes: 30 }) };

      await expect(serviceWith(brevo).send(mail)).resolves.toEqual({ ok: true });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.brevo.com/v3/smtp/email");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "api-key": API_KEY, "Content-Type": "application/json" });
      expect(JSON.parse(String(init.body))).toEqual({
        sender: { email: "no-reply@notify.appsgain.in", name: "Appsgain" },
        to: [{ email: "neha@example.com" }],
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
      });
      expect(reportMessage).not.toHaveBeenCalled();
    });

    it("reports a refusal by kind, with the key redacted and the code nowhere in the log", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ code: "unauthorized", message: `Key not found: ${API_KEY}` }), { status: 401 }),
      );

      const result = await serviceWith(brevo).send(verification());

      expect(result).toEqual({ ok: false, reason: "Brevo refused the email (HTTP 401: Key not found: ••••)" });
      const lines = logged(logSpies);
      expect(lines).toContain("Email (verification) to pr•••@example.com failed");
      expect(lines).not.toContain(CODE);
      expect(lines).not.toContain(API_KEY);
      expect(lines).not.toContain("priya.sharma@");

      expect(reportMessage).toHaveBeenCalledWith("Platform email failed", "error", {
        tags: { mailKind: "verification", mailDriver: "brevo" },
        extra: { reason: "Brevo refused the email (HTTP 401: Key not found: ••••)" },
      });
      expect(JSON.stringify(jest.mocked(reportMessage).mock.calls)).not.toContain(CODE);
    });

    it("reports Brevo being unreachable", async () => {
      fetchMock.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }));

      const result = await serviceWith(brevo).send(verification());

      expect(result).toEqual({ ok: false, reason: "Could not reach Brevo: the host name does not resolve" });
      expect(reportMessage).toHaveBeenCalledWith(
        "Platform email failed",
        "error",
        expect.objectContaining({ tags: { mailKind: "verification", mailDriver: "brevo" } }),
      );
    });
  });

  it("names an unsendable message by kind, never by its subject", async () => {
    const result = await serviceWith({ NODE_ENV: "production" }).send(verification());

    expect(result).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    const lines = logged(logSpies);
    expect(lines).toContain("Email (verification) to pr•••@example.com not sent");
    expect(lines).not.toContain(CODE);
    expect(reportMessage).toHaveBeenCalledWith(
      "Platform email not sent: no email provider is configured for production",
      "warning",
      { tags: { mailKind: "verification", mailDriver: "none" } },
    );
  });

  it("writes the whole message to the log under the log driver, outside production only", async () => {
    const mail = { to: "neha@example.com", ...invitationMail({ workspace: "Northwind", inviter: "Asha", role: "AGENT", link: "https://app/accept-invite?token=t", days: 7 }) };

    await expect(serviceWith({ MAIL_DRIVER: "log", NODE_ENV: "development" }).send(mail)).resolves.toEqual({ ok: true });

    expect(fetchMock).not.toHaveBeenCalled();
    const lines = logged(logSpies);
    expect(lines).toContain("invitation email (not sent: MAIL_DRIVER=log)");
    expect(lines).toContain("https://app/accept-invite?token=t");
  });

  it("gives every template a kind", () => {
    expect(passwordResetMail({ name: "A", workspace: "W", link: "https://x", minutes: 30 }).kind).toBe("reset");
    expect(verificationCodeMail({ name: "A", code: CODE, minutes: 10 }).kind).toBe("verification");
    expect(invitationMail({ workspace: "W", inviter: null, role: "AGENT", link: "https://x", days: 7 }).kind).toBe("invitation");
    expect(securityNoticeMail({ name: "A", event: "Your password was changed", detail: "D" }).kind).toBe("security-notice");
  });
});
