"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A small dropdown menu: a trigger button with a list of actions under it.
 *
 * It opens on `click` — the event a mouse, a touch and a keyboard Enter/Space all produce
 * on a button — so it answers every way a person can press the trigger. Escape and a
 * press outside close it, arrow keys move between items, focus moves into the menu when
 * it opens and back to the trigger when Escape closes it.
 */
export function DropdownMenu({
  trigger,
  children,
  align = "end",
  className,
}: {
  /** A `<button>`; its own onClick still runs. */
  trigger: ReactElement<{ onClick?: (event: MouseEvent) => void }>;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const items = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (event.key === "Tab") {
        close(false);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const list = items();
        if (list.length === 0) return;
        const index = list.indexOf(document.activeElement as HTMLElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        list[(index + step + list.length) % list.length].focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      {cloneElement(trigger, {
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: (event: MouseEvent) => {
          trigger.props.onClick?.(event);
          setOpen((shown) => !shown);
        },
      } as Record<string, unknown>)}

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          // An item's own onClick runs first (it is deeper); then the menu closes. Focus
          // is left alone, because the item may have opened a dialog that wants it.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) close(false);
          }}
          className={cn(
            "absolute top-full z-50 mt-1.5 min-w-[200px] rounded-card border border-slate-200 bg-surface p-1.5 shadow-card",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const ITEM =
  "flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-brand-navy outline-none hover:bg-slate-100 focus:bg-slate-100";

export function MenuItem({
  onSelect,
  danger,
  children,
}: {
  onSelect: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(ITEM, danger && "text-[#C93B3B]")}
    >
      {children}
    </button>
  );
}

export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} role="menuitem" className={ITEM}>
      {children}
    </Link>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-slate-100" />;
}
