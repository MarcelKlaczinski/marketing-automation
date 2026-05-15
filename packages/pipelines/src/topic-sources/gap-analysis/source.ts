import { z } from "zod";
import type { ContentGap, TopicBriefInsert } from "@marketing-auto/db";
import type { TopicSource, TopicSourceContext } from "../types.ts";
import { mapGapToBrief } from "./map-gap-to-brief.ts";

type Input = { gaps: ContentGap[] };

export class GapAnalysisTopicSource implements TopicSource<Input> {
  readonly source = "gap_analysis" as const;

  readonly inputSchema: z.ZodType<Input> = z.object({
    gaps: z.array(z.unknown()),
  }) as z.ZodType<Input>;

  async emit(input: Input, _ctx: TopicSourceContext): Promise<TopicBriefInsert[]> {
    const eligible = input.gaps.filter(
      (g) => g.status === "open" || g.status === "in_progress",
    );
    return eligible.map(mapGapToBrief);
  }
}
