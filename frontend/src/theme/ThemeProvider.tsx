/**
 * Light, dark, or whatever the operating system says.
 *
 * The choice lives in `localStorage` and not on the account: it is a property
 * of the screen somebody is sitting at, not of who they are, and a student who
 * reads on a laptop by day and a phone at night wants different answers on each.
 * `User.locale` is on the account for the opposite reason.
 *
 * "system" is the default and stays live — the media query is still listened to
 * after the first paint, so a machine that switches at sunset switches this too.
 */

import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "mca.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeValue {
  theme: Theme;
  /** What is actually painted right now, with "system" already resolved. */
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeValue | null>(null);

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

function storedTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    // Private browsing and blocked site data both throw rather than return
    // null. A reader who cannot be remembered still gets a readable page.
    return "system";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setStored] = useState<Theme>(storedTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const listen = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);

  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // On the root element rather than in React's tree: `body` is painted by the
  // browser before any component mounts, and the variables live on :root.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies to this page; it just will not outlive it.
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
