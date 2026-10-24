import { ClerkBoundary } from "@/components/auth/clerk-boundary";

/**
 * Sign-in and the two pages Clerk returns to after Google or Microsoft (sso-callback,
 * sso-complete) are the only routes besides sign-up that load Clerk. See ClerkBoundary.
 */
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <ClerkBoundary>{children}</ClerkBoundary>;
}
