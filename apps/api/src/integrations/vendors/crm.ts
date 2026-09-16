import { dig, hostMatches, redactSecrets, text, vendorFetch, vendorMessage, type VendorResponse } from "./http";
import { zohoAccessToken } from "./zoho";

/**
 * Lead sync: one new Appsgain lead becomes one record in the connected CRM.
 *
 * One direction and one moment on purpose — creation. Two-way sync (TRD §2, "Deep CRM
 * two-way sync — Phase 2") needs conflict rules about which side wins an edit, and
 * guessing at those would quietly overwrite somebody's CRM. Creating a record that did not
 * exist is the one write that cannot clobber anything, and where the CRM can match on
 * phone number first, an existing contact is left exactly as it was.
 */

export type Credentials = Record<string, string>;

export interface CrmLead {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  company?: string;
}

export type CrmResult =
  | { ok: true; externalId?: string; alreadyExisted?: boolean }
  | { ok: false; reason: string };

export async function pushLeadToCrm(
  provider: string,
  credentials: Credentials,
  lead: CrmLead,
): Promise<CrmResult> {
  switch (provider) {
    case "hubspot":
      return hubspot(credentials, lead);
    case "pipedrive":
      return pipedrive(credentials, lead);
    case "freshsales":
      return freshsales(credentials, lead);
    case "zoho_crm":
      return zoho(credentials, lead);
    case "salesforce":
      return salesforce(credentials, lead);
    default:
      return { ok: false, reason: `${provider} does not sync leads.` };
  }
}

/** "Priya Sharma" → { first: "Priya", last: "Sharma" }; one word is a last name, as CRMs require one. */
export function splitName(name: string): { first: string; last: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: "", last: words[0] ?? "Unknown" };
  return { first: words.slice(0, -1).join(" "), last: words[words.length - 1] };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function refused(vendor: string, response: VendorResponse, secrets: string[]): CrmResult {
  if (response.status === 0) return { ok: false, reason: `Could not reach ${vendor}: ${response.error}` };
  const message = vendorMessage(response);
  return {
    ok: false,
    reason: `${vendor} refused the lead (HTTP ${response.status}${
      message ? `: ${redactSecrets(message, secrets)}` : ""
    })`,
  };
}

function idOf(value: unknown): string | undefined {
  return typeof value === "number" ? String(value) : text(value);
}

async function hubspot({ accessToken }: Credentials, lead: CrmLead): Promise<CrmResult> {
  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${accessToken}` };

  const search = await vendorFetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers,
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: lead.phone }] }],
      properties: ["phone"],
      limit: 1,
    }),
  });
  if (!search.ok) return refused("HubSpot", search, [accessToken]);

  const existing = idOf(dig(search.body, "results", 0, "id"));
  if (existing) return { ok: true, externalId: existing, alreadyExisted: true };

  const { first, last } = splitName(lead.name);
  const created = await vendorFetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      properties: {
        firstname: first,
        lastname: last,
        phone: lead.phone,
        city: lead.city ?? "",
        lifecyclestage: "lead",
        ...(lead.company ? { company: lead.company } : {}),
      },
    }),
  });

  return created.ok
    ? { ok: true, externalId: idOf(dig(created.body, "id")) }
    : refused("HubSpot", created, [accessToken]);
}

async function pipedrive({ apiToken }: Credentials, lead: CrmLead): Promise<CrmResult> {
  const token = encodeURIComponent(apiToken);

  const search = await vendorFetch(
    `https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(lead.phone)}` +
      `&fields=phone&exact_matching=true&limit=1&api_token=${token}`,
  );
  if (!search.ok) return refused("Pipedrive", search, [apiToken]);

  const existing = idOf(dig(search.body, "data", "items", 0, "item", "id"));
  if (existing) return { ok: true, externalId: existing, alreadyExisted: true };

  const created = await vendorFetch(`https://api.pipedrive.com/v1/persons?api_token=${token}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      name: lead.name,
      phone: [{ value: lead.phone, primary: true, label: "mobile" }],
    }),
  });

  return created.ok
    ? { ok: true, externalId: idOf(dig(created.body, "data", "id")) }
    : refused("Pipedrive", created, [apiToken]);
}

/** The API base for a Freshsales domain, or null when it is not one of Freshworks' hosts. */
export function freshsalesBase(domain: string | undefined): string | null {
  const host = (domain ?? "").trim().toLowerCase();
  if (/^[a-z0-9-]+\.myfreshworks\.com$/.test(host)) return `https://${host}/crm/sales/api`;
  if (/^[a-z0-9-]+\.freshsales\.io$/.test(host)) return `https://${host}/api`;
  return null;
}

async function freshsales({ domain, apiKey }: Credentials, lead: CrmLead): Promise<CrmResult> {
  const base = freshsalesBase(domain);
  if (!base) return { ok: false, reason: "The stored Freshsales domain is not valid. Connect again." };

  const { first, last } = splitName(lead.name);
  const created = await vendorFetch(`${base}/contacts`, {
    method: "POST",
    headers: { ...JSON_HEADERS, Authorization: `Token token=${apiKey}` },
    body: JSON.stringify({
      contact: {
        first_name: first || undefined,
        last_name: last,
        mobile_number: lead.phone,
        city: lead.city ?? undefined,
      },
    }),
  });

  return created.ok
    ? { ok: true, externalId: idOf(dig(created.body, "contact", "id")) }
    : refused("Freshsales", created, [apiKey]);
}

async function zoho(credentials: Credentials, lead: CrmLead): Promise<CrmResult> {
  const token = await zohoAccessToken(credentials);
  if (!token.ok) return { ok: false, reason: token.reason };

  const { first, last } = splitName(lead.name);
  // Upsert on phone: a lead Zoho already has is updated rather than duplicated.
  const response = await vendorFetch(`${token.apiDomain}/crm/v6/Leads/upsert`, {
    method: "POST",
    headers: { ...JSON_HEADERS, Authorization: `Zoho-oauthtoken ${token.accessToken}` },
    body: JSON.stringify({
      data: [
        {
          Last_Name: last,
          First_Name: first || undefined,
          Company: lead.company ?? lead.name,
          Phone: lead.phone,
          City: lead.city ?? undefined,
        },
      ],
      duplicate_check_fields: ["Phone"],
    }),
  });

  const row = dig(response.body, "data", 0);
  if (response.ok && dig(row, "code") === "SUCCESS") {
    return {
      ok: true,
      externalId: idOf(dig(row, "details", "id")),
      alreadyExisted: dig(row, "action") === "update",
    };
  }
  const message = text(dig(row, "message")) ?? vendorMessage(response);
  return {
    ok: false,
    reason: `Zoho CRM refused the lead (HTTP ${response.status}${message ? `: ${message}` : ""})`,
  };
}

/** True for a Salesforce instance URL — the only host a Salesforce token is sent to. */
export function isSalesforceInstance(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (parsed.pathname === "/" || parsed.pathname === "") &&
      (hostMatches(host, ".salesforce.com") || hostMatches(host, ".force.com"))
    );
  } catch {
    return false;
  }
}

async function salesforce(
  { accessToken, instanceUrl }: Credentials,
  lead: CrmLead,
): Promise<CrmResult> {
  if (!isSalesforceInstance(instanceUrl)) {
    return { ok: false, reason: "The stored Salesforce instance is not valid. Connect again." };
  }

  const { first, last } = splitName(lead.name);
  const origin = new URL(instanceUrl).origin;
  const response = await vendorFetch(`${origin}/services/data/v60.0/sobjects/Lead`, {
    method: "POST",
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      FirstName: first || undefined,
      LastName: last,
      Company: lead.company ?? lead.name,
      Phone: lead.phone,
      City: lead.city ?? undefined,
    }),
  });

  if (response.ok) return { ok: true, externalId: idOf(dig(response.body, "id")) };

  // Salesforce reports errors as an array: [{ message, errorCode }].
  const message = text(dig(response.body, 0, "message")) ?? vendorMessage(response);
  return {
    ok: false,
    reason: `Salesforce refused the lead (HTTP ${response.status}${message ? `: ${message}` : ""})`,
  };
}
