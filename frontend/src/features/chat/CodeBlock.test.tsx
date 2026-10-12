// @vitest-environment jsdom

/**
 * A code block of an answer names its language and copies its code, as the
 * reader sees it.
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import { mount } from "@/test/mount";
import { AnswerMarkdown } from "./AnswerMarkdown";

function block(text: string) {
  return mount(<AnswerMarkdown text={text} citations={[]} />);
}

describe("a code block", () => {
  it("names the language its fence named, and copies the code without the closing newline", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    const { container, unmount } = block("```sql\nSELECT 1;\nSELECT 2;\n```");
    const head = container.querySelector("pre")?.previousElementSibling;
    const copy = head?.querySelector("button");

    const language = head?.querySelector(".font-mono")?.textContent;
    await act(async () => copy?.click());
    const seen = {
      button: copy?.textContent,
      said: head?.querySelector('[role="status"]')?.textContent,
    };
    unmount();

    expect(language).toBe("sql");
    expect(written).toEqual(["SELECT 1;\nSELECT 2;"]);
    expect(seen).toEqual({ button: "Copiato", said: "Copiato" });
  });

  it("names nothing when its fence named no language", () => {
    const { container, unmount } = block("```\nplain\n```");
    const head = container.querySelector("pre")?.previousElementSibling;
    const seen = {
      language: head?.querySelector(".font-mono")?.textContent,
      button: head?.querySelector("button")?.textContent,
    };
    unmount();

    expect(seen).toEqual({ language: "", button: "Copia" });
  });
});
