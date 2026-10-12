// @vitest-environment jsdom

/**
 * A toggle group always holds a value: pressing the chosen option again
 * leaves it chosen, and pressing another chooses that one. Read off a mounted
 * group, since Radix decides the press.
 */

import { act, useState } from "react";
import { expect, it } from "vitest";

import { mount } from "@/test/mount";
import { ToggleGroup } from "./toggle-group";

function Theme() {
  const [value, setValue] = useState<"light" | "dark">("light");
  return (
    <ToggleGroup
      label="Aspetto"
      value={value}
      onValueChange={setValue}
      options={[
        { value: "light", label: "Chiaro" },
        { value: "dark", label: "Scuro" },
      ]}
    />
  );
}

it("keeps its choice when the chosen option is pressed again, and moves it on another", () => {
  const { container, unmount } = mount(<Theme />);
  const option = (label: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === label);
  const chosen = () =>
    [...container.querySelectorAll("button")]
      .filter((button) => button.getAttribute("data-state") === "on")
      .map((button) => button.textContent);

  act(() => option("Chiaro")?.click());
  const again = chosen();
  act(() => option("Scuro")?.click());
  const moved = chosen();
  unmount();

  expect({ again, moved }).toEqual({ again: ["Chiaro"], moved: ["Scuro"] });
});
