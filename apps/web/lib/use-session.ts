"use client";

import { useEffect, useState } from "react";
import { hasPermission, isPermission, ROLES, type Permission, type Role } from "@appsgain/shared";
import { getSessionUser, SESSION_CHANGED_EVENT, type SessionUser } from "@/lib/api-client";

/**
 * The signed-in user, read from session storage after hydration.
 *
 * Deliberately `null` on the first render even when a session exists: session storage
 * does not exist on the server, so returning the real user immediately would make the
 * server and client markup disagree and React would throw the whole tree away. One frame
 * of "not yet known" is the price of not hydrating twice.
 */
export function useSessionUser(): { user: SessionUser | null; resolved: boolean } {
  const [state, setState] = useState<{ user: SessionUser | null; resolved: boolean }>({
    user: null,
    resolved: false,
  });

  useEffect(() => {
    setState({ user: getSessionUser(), resolved: true });

    // Another tab signing out must not leave this one showing a signed-in shell; a profile
    // edit in this tab must reach the header without a reload.
    const onChange = () => setState({ user: getSessionUser(), resolved: true });
    window.addEventListener("storage", onChange);
    window.addEventListener(SESSION_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(SESSION_CHANGED_EVENT, onChange);
    };
  }, []);

  return state;
}

/** Narrows the role string cached with the session to the shared `Role` union. */
export function toRole(value: string | undefined): Role | null {
  return value && (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

/**
 * Whether the signed-in user holds a permission.
 *
 * `undefined` while the session is still being read, so callers can tell "no" apart from
 * "not yet" and avoid flashing a disabled UI at someone who is in fact allowed.
 */
export function usePermission(permission: Permission | string): boolean | undefined {
  const { user, resolved } = useSessionUser();
  if (!resolved) return undefined;
  const role = toRole(user?.role);
  if (!role || !isPermission(permission)) return false;
  return hasPermission(role, permission);
}
