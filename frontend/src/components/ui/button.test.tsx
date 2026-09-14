/**
 * The first `.tsx` test in the repository, and its real subject is the config.
 *
 * Until this file existed, the `include` glob in vite.config.ts ended in
 * `.test.ts` and nothing else, so a `.tsx` test would not have failed — it
 * would not have been collected, and the suite would have gone green without
 * it. That is why the evidence this stage produces is the test *count*, not
 * the pass rate.
 */

import { expect, it } from "vitest";

import { render } from "@/test/render";
import { Button } from "./button";

it("renders its children", () => {
  expect(render(<Button>ok</Button>)).toContain("ok");
});

it("carries the accent as its default variant", () => {
  // Not decoration: `bg-accent` is the single most visible consumer of the
  // accent token, so a change to that token shows up here first.
  expect(render(<Button>ok</Button>)).toContain("bg-accent");
});
