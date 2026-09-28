import { expect, it } from "vitest";

import { render } from "@/test/render";
import { Button } from "./button";

it("carries the accent as its default variant", () => {
  // Not decoration: `bg-accent` is the single most visible consumer of the
  // accent token, so a change to that token shows up here first.
  expect(render(<Button>ok</Button>)).toContain("bg-accent");
});
