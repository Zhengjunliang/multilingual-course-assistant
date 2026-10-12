/**
 * Copying to the clipboard, and saying so for a while.
 *
 * Every copy button of an answer (the answer, a code block, a citation) shows
 * a tick and its word for `COPIED_MS` once the browser took the text, and a
 * live region beside it says the same to a screen reader. A browser that
 * refuses the clipboard (an insecure origin, a denied permission) leaves the
 * button as it was, which says it did not copy.
 */

import { useCallback, useEffect, useState } from "react";

/** How long a copy button shows its tick: long enough to see, gone before a second copy. */
const COPIED_MS = 2000;

export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Refused: nothing changes, which is the message.
    }
  }, []);

  return { copied, copy };
}
