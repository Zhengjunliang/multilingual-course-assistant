/**
 * A session's browser and system, read from the `User-Agent` it signed in
 * with, for the list of an account's sessions: "Chrome · Windows", as
 * GitHub's and Google's lists of sessions name a device (outside the
 * repository). Only families a reader recognises are named; a string with
 * neither is returned as it came, and an empty one stays empty.
 *
 * The order matters: every Chromium browser also says "Chrome" and "Safari",
 * Edge and Opera name themselves after both, and Android says "Linux".
 */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/(Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function first(patterns: typeof BROWSERS, userAgent: string): string | undefined {
  return patterns.find(([pattern]) => pattern.test(userAgent))?.[1];
}

export function deviceName(userAgent: string): string {
  const named = [first(BROWSERS, userAgent), first(SYSTEMS, userAgent)].filter(
    (name) => name !== undefined,
  );
  return named.length === 0 ? userAgent : named.join(" · ");
}
