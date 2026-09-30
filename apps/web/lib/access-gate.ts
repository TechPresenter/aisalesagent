/**
 * The password gate in front of the pre-release environments (DEV, QA and UAT).
 *
 * Plain HTTP Basic authentication, checked in middleware.ts. It keeps unfinished builds
 * away from the public and from search engines without asking testers or the client to
 * hold a Vercel account. It is not the product's sign-in; that still happens inside the
 * app, against the API.
 *
 * Written for the Edge runtime, where middleware runs: Web APIs only (atob, TextEncoder),
 * nothing from Node.
 */

export interface GateCredentials {
  username: string;
  password: string;
}

/** The gate's credentials, or null when the gate is off — on LIVE and in local development. */
export function gateCredentials(
  username: string | undefined,
  password: string | undefined,
): GateCredentials | null {
  return username && password ? { username, password } : null;
}

/** Whether an Authorization header carries exactly these Basic credentials. */
export function basicAuthMatches(header: string | null, expected: GateCredentials): boolean {
  const match = header?.match(/^Basic\s+(\S+)$/i);
  if (!match) return false;

  let decoded: string;
  try {
    decoded = decodeBase64Utf8(match[1]);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  // Both comparisons always run, so a wrong username takes as long as a wrong password.
  const usernameMatches = constantTimeEqual(decoded.slice(0, separator), expected.username);
  const passwordMatches = constantTimeEqual(decoded.slice(separator + 1), expected.password);
  return usernameMatches && passwordMatches;
}

/** Browsers send Basic credentials as UTF-8 inside base64; atob alone would garble non-ASCII. */
function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Compares every byte of the longer input, so the time taken does not show how much matched. */
function constantTimeEqual(actual: string, expected: string): boolean {
  const left = new TextEncoder().encode(actual);
  const right = new TextEncoder().encode(expected);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}
