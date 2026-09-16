"use client";

import type { ReactNode } from "react";
import type { Permission } from "@appsgain/shared";
import { usePermission } from "@/lib/use-session";

/**
 * Renders `children` only if the signed-in user holds `permission`.
 *
 * This is presentation, not security. Every endpoint behind these controls carries its
 * own `@RequirePermissions(...)` guard, and that guard is what actually stops the action
 * — anyone can delete a DOM node. What this buys is honesty: a button that will always
 * return 403 is worse than no button, because the user reads it as a capability they
 * have and cannot work out why it fails.
 *
 * While the session is still being read from storage nothing is rendered, so a control
 * never appears and then vanishes under the cursor.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = usePermission(permission);
  if (allowed === undefined) return null;
  return <>{allowed ? children : fallback}</>;
}
