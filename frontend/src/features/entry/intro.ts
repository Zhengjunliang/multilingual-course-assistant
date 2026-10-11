/**
 * The entry's intro (#173): on a visitor's first visit the cat is drawn in one
 * stroke, and the caption asks one question in six languages in turn before
 * it settles on the interface's own line. 4.6 s, once, skippable, and never
 * for a reader who asked for reduced motion.
 *
 * Seen once is seen: the flag is kept in `localStorage` the moment the intro
 * starts, so leaving halfway does not play it again. Every read and write is
 * wrapped, because a private window or blocked site data throws there, and a
 * reader who cannot be remembered still gets a working page, intro included.
 */

import { useEffect, useState } from "react";

const SEEN = "mca.intro";

/** Seconds. */
export const INTRO = { length: 4.6, firstLine: 1.2, perLine: 0.56 } as const;

/**
 * The question, each in its language: data, shown as written whatever the
 * interface's language is, since the point is that any of them can be asked.
 */
export const LINES = [
  { lang: "it", text: "Dove si trova l'aula 3?" },
  { lang: "en", text: "Where is room 3?" },
  { lang: "zh", text: "3号教室在哪里？" },
  { lang: "fr", text: "Où se trouve la salle 3 ?" },
  { lang: "es", text: "¿Dónde está el aula 3?" },
  { lang: "ar", text: "أين تقع القاعة 3؟" },
] as const;

export type Line = (typeof LINES)[number];

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "seen";
  } catch {
    return false;
  }
}

/**
 * Whether the intro is playing, the line it is on (`null` before the first),
 * and a way to skip it. `play` is whether this reader may get it at all: a
 * visitor, with motion allowed; it turning false mid-way ends the intro.
 */
export function useIntro(play: boolean): {
  playing: boolean;
  line: Line | null;
  skip: () => void;
} {
  const [playing, setPlaying] = useState(() => play && !seen());
  const [line, setLine] = useState<Line | null>(null);

  useEffect(() => {
    if (!play) setPlaying(false);
  }, [play]);

  useEffect(() => {
    if (!playing) return;
    try {
      localStorage.setItem(SEEN, "seen");
    } catch {
      // Not remembered: the next visit plays it again, which is no harm.
    }
    const timers = LINES.map((each, i) =>
      setTimeout(() => setLine(each), (INTRO.firstLine + i * INTRO.perLine) * 1000),
    );
    timers.push(setTimeout(() => setPlaying(false), INTRO.length * 1000));
    return () => timers.forEach(clearTimeout);
  }, [playing]);

  return { playing, line, skip: () => setPlaying(false) };
}
