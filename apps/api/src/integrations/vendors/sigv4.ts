import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, for the one request the storage integrations make: "can these
 * keys see this bucket?"
 *
 * Written out rather than pulled in with the AWS SDK because that request is all this
 * module needs, and the SDK is a large dependency to take on for one HEAD. Cloudflare R2
 * and Google Cloud Storage's interoperability API accept the same signature with their
 * own keys, so this one implementation covers all three storage integrations.
 */
export interface SigV4Request {
  method: string;
  url: URL;
  /** Extra headers to sign, names in any case. `host` and `x-amz-date` are added here. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}

export interface SigV4Result {
  authorization: string;
  amzDate: string;
  signature: string;
  canonicalRequest: string;
  stringToSign: string;
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** 2015-08-30T12:36:00.000Z → 20150830T123600Z */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function signV4(request: SigV4Request): SigV4Result {
  const stamp = amzDate(request.date);
  const day = stamp.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = value;
  }
  headers.host = request.url.host;
  headers["x-amz-date"] = stamp;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");

  const canonicalQuery = Array.from(request.url.searchParams.entries())
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a, aValue], [b, bValue]) => (a === b ? compare(aValue, bValue) : compare(a, b)))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const canonicalPath =
    request.url.pathname
      .split("/")
      .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
      .join("/") || "/";

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join("\n");

  const scope = `${day}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const dateKey = hmac(`AWS4${request.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, request.region);
  const serviceKey = hmac(regionKey, request.service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    authorization:
      `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate: stamp,
    signature,
    canonicalRequest,
    stringToSign,
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
