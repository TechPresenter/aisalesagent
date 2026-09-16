/**
 * The frame every pre-login screen sits in: the soft brand wash, centred content, and
 * enough vertical padding that a tall form (Create Account) still breathes on a laptop
 * while a short one (Forgot Password) stays optically centred.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="brand-wash flex min-h-screen items-center justify-center bg-[#FBFAFD] px-4 py-8 sm:py-12">
      {children}
    </div>
  );
}
