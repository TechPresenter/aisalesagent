"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delay` ms.
 *
 * Used for search boxes that drive a request. The first value is returned immediately
 * rather than after a delay, so a screen does not start its life with an empty list for
 * a third of a second before the real one arrives.
 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay, settled]);

  return settled;
}
