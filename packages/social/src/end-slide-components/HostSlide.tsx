/**
 * Spec 65.9 — HostSlide dispatcher.
 *
 * Single entry-point that every carousel template imports as its final
 * frame. Switches on `data.type` and renders the matching concrete
 * end-slide component, all of which share the `EndSlideBase` layout.
 *
 * The `default: never`-check makes adding a new end-slide type a
 * compile-time error here until all switch arms are extended — paired
 * with the discriminated-union in `./types`, the only way to ship a new
 * type without updating this file is to skip the unit test, which
 * exercises every branch.
 */
import React from "react";
import { CommentToGetSlide } from "./CommentToGetSlide";
import { FollowCtaSlide } from "./FollowCtaSlide";
import { LinkInBioSlide } from "./LinkInBioSlide";
import { QuoteActionSlide } from "./QuoteActionSlide";
import { SaveShareSlide } from "./SaveShareSlide";
import { SwipeUpSlide } from "./SwipeUpSlide";
import { TagFriendSlide } from "./TagFriendSlide";
import type { EndSlideProps } from "./types";

export const HostSlide: React.FC<EndSlideProps> = (props) => {
  const { data } = props;
  switch (data.type) {
    case "follow-cta":
      return <FollowCtaSlide {...props} data={data} />;
    case "comment-to-get":
      return <CommentToGetSlide {...props} data={data} />;
    case "link-in-bio":
      return <LinkInBioSlide {...props} data={data} />;
    case "tag-friend":
      return <TagFriendSlide {...props} data={data} />;
    case "save-share-cta":
      return <SaveShareSlide {...props} data={data} />;
    case "swipe-up":
      return <SwipeUpSlide {...props} data={data} />;
    case "quote-action":
      return <QuoteActionSlide {...props} data={data} />;
    default: {
      // Exhaustive switch — TS error here means a new end-slide type was added to
      // EndSlideData without extending HostSlide's switch.
      const _exhaustive: never = data;
      void _exhaustive;
      throw new Error(
        `HostSlide: unhandled end-slide type '${(data as { type: string }).type}'`,
      );
    }
  }
};
