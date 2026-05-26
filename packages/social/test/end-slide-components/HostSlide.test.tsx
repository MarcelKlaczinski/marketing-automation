/**
 * Spec 65.9 — HostSlide dispatcher tests.
 *
 * Pure structural tests — verify that each EndSlideData variant dispatches
 * to the right concrete component without booting Remotion / React DOM.
 * The exhaustive `never`-check is verified at TypeScript-compile time
 * (typecheck pass = exhaustive switch); this file covers the runtime
 * dispatch correctness + the runtime throw path for impossible input.
 */
import { describe, expect, it } from "bun:test";
import type React from "react";
import { CommentToGetSlide } from "../../src/end-slide-components/CommentToGetSlide";
import { FollowCtaSlide } from "../../src/end-slide-components/FollowCtaSlide";
import { HostSlide } from "../../src/end-slide-components/HostSlide";
import { LinkInBioSlide } from "../../src/end-slide-components/LinkInBioSlide";
import { QuoteActionSlide } from "../../src/end-slide-components/QuoteActionSlide";
import { SaveShareSlide } from "../../src/end-slide-components/SaveShareSlide";
import { SwipeUpSlide } from "../../src/end-slide-components/SwipeUpSlide";
import { TagFriendSlide } from "../../src/end-slide-components/TagFriendSlide";
import type { EndSlideData, EndSlideProps } from "../../src/end-slide-components/types";

interface DispatchCase {
  name: string;
  data: EndSlideData;
  expected: React.FC<EndSlideProps<EndSlideData>>;
}

const CASES: DispatchCase[] = [
  {
    name: "follow-cta",
    data: { type: "follow-cta", config: { handle: "@toolwiki.ai" } },
    expected: FollowCtaSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
  {
    name: "comment-to-get",
    data: {
      type: "comment-to-get",
      config: { keyword: "CLAUDE", resourceTitle: "Claude Prompts Pack" },
    },
    expected: CommentToGetSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
  {
    name: "link-in-bio",
    data: { type: "link-in-bio", config: { description: "Full comparison at toolwiki.ai" } },
    expected: LinkInBioSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
  {
    name: "tag-friend",
    data: { type: "tag-friend", config: { prompt: "Wer braucht das?" } },
    expected: TagFriendSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
  {
    name: "save-share-cta",
    data: {
      type: "save-share-cta",
      config: { primaryAction: "save", message: "Speichern für später" },
    },
    expected: SaveShareSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
  {
    name: "swipe-up",
    data: { type: "swipe-up", config: { destination: "toolwiki.ai" } },
    expected: SwipeUpSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
  {
    name: "quote-action",
    data: {
      type: "quote-action",
      config: { quote: "Stop scrolling. Try Claude for 30 seconds." },
    },
    expected: QuoteActionSlide as React.FC<EndSlideProps<EndSlideData>>,
  },
];

describe("HostSlide dispatch", () => {
  for (const c of CASES) {
    it(`renders ${c.name} → ${c.expected.name}`, () => {
      // Invoke HostSlide as a function (it's a React.FC = (props) => ReactElement).
      // No Remotion/React DOM needed — we only assert on the returned element's `.type`.
      const element = HostSlide({ data: c.data, theme: "dark", locale: "de" }) as
        | React.ReactElement<unknown, React.FC<EndSlideProps<EndSlideData>>>
        | null;
      expect(element).not.toBeNull();
      expect(element?.type).toBe(c.expected);
      expect(element?.props.data).toBe(c.data);
      expect(element?.props.theme).toBe("dark");
      expect(element?.props.locale).toBe("de");
    });
  }

  it("throws on impossible type at runtime (defense beyond TS exhaustive-check)", () => {
    const bogus = { type: "not-a-real-type", config: {} } as unknown as EndSlideData;
    expect(() => HostSlide({ data: bogus, theme: "dark", locale: "de" })).toThrow(
      /HostSlide: unhandled end-slide type 'not-a-real-type'/,
    );
  });

  it("propagates brandTokens prop to the picked child", () => {
    const brandTokens = { colors: { brandHue: 180 } };
    const element = HostSlide({
      data: { type: "follow-cta", config: { handle: "@x" } },
      theme: "light",
      locale: "en",
      brandTokens,
    }) as React.ReactElement<EndSlideProps<EndSlideData>> | null;
    expect(element?.props.brandTokens).toBe(brandTokens);
    expect(element?.props.theme).toBe("light");
    expect(element?.props.locale).toBe("en");
  });
});
