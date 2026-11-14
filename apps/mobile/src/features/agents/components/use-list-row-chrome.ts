import { useEffect, useState } from "react";

const CHROME_DELAY = 80;
const CHROME_STAGGER = 40;
const CHROME_GROUP = 6;

/**
 * A row that mounts while the home list moves draws its picture and its text first. The swipe and the
 * long-press menu mount after the list has stopped, a few rows at a time. A row that mounts on a
 * list that is not moving keeps both at once.
 */
export function useListRowChrome(defer: boolean, scrolling: boolean, index: number): boolean {
  // The first value is the one that matters: a row keeps the chrome it started with once that chrome
  // is ready, so a later scroll does not take the menu off a row the reader can already touch.
  const [ready, setReady] = useState(() => !defer || !scrolling);
  useEffect(() => {
    if (!defer || ready || scrolling) return;
    const delay = CHROME_DELAY + (index % CHROME_GROUP) * CHROME_STAGGER;
    const timeout = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timeout);
  }, [defer, index, ready, scrolling]);
  return ready;
}
