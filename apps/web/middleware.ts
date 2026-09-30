import { NextResponse, type NextRequest } from "next/server";
import { basicAuthMatches, gateCredentials } from "@/lib/access-gate";

/**
 * Keeps DEV, QA and UAT private (docs/deployment.md, "Access control").
 *
 * The gate is on wherever ACCESS_GATE_USERNAME and ACCESS_GATE_PASSWORD are set, which is
 * the three pre-release environments, and off on LIVE and in local development. It covers
 * the web app only: the API is its own Vercel project on its own subdomain with its own
 * sign-in, so these Basic credentials never travel with the API's bearer tokens.
 */
export function middleware(request: NextRequest): NextResponse {
  const credentials = gateCredentials(process.env.ACCESS_GATE_USERNAME, process.env.ACCESS_GATE_PASSWORD);
  if (!credentials) return NextResponse.next();

  if (!basicAuthMatches(request.headers.get("authorization"), credentials)) {
    return new NextResponse("This pre-release environment needs its access password.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Appsgain pre-release", charset="UTF-8"',
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  const response = NextResponse.next();
  // Pre-release builds stay out of search results even if a link to one leaks.
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  // Everything except Next's build assets and the favicon. They hold no data, and the
  // browser asking for them has already passed the gate for the page itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
