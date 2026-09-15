import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/ui/avatar";
import { render } from "@/test/render";

describe("the avatar", () => {
  it("shows the first letter of the name, uppercased", () => {
    expect(render(<Avatar name="junliang" />)).toContain(">J<");
  });

  it("renders without a letter rather than breaking on an empty name", () => {
    // `Account.username` is required by the serializer, so this is not a state
    // the API can produce — but a component that throws on "" is a component
    // that throws during a form's first keystroke.
    expect(render(<Avatar name="" />)).toContain("<span");
  });

  it("takes a whole character, not half a surrogate pair", () => {
    // `name[0]` on an astral character yields a lone surrogate, which renders
    // as a replacement square. Splitting by code point is what avoids it.
    const html = render(<Avatar name="𝒥uliet" />);

    expect(html).not.toContain("�");
    expect(html).toContain("𝒥");
  });
});
