import { ClerkBoundary } from "@/components/auth/clerk-boundary";

/** Sign-up offers "Continue with Google / Microsoft" too, so it loads Clerk. See ClerkBoundary. */
export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return <ClerkBoundary>{children}</ClerkBoundary>;
}
