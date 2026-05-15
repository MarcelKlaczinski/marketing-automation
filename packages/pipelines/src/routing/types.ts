export type GenerationMode =
  | "evergreen"
  | "timely"
  | "pillar"
  | "spoke"
  | "refresh"
  | "translation";

export type RoutingDecision =
  | {
      kind: "create_article";
      clusterId: string;
      intentType: string;
      mode: GenerationMode;
    }
  | {
      kind: "create_cornerstone_spec";
      clusterId: string;
      mode: "pillar";
    }
  | {
      kind: "create_translation";
      sourceTranslationKey: string;
      targetLocale: "de" | "en";
      clusterId: string | null;
    }
  | {
      kind: "refresh_article";
      targetArticleId: string;
    }
  | {
      kind: "create_cluster";
      pillarHint: string | null;
    }
  | {
      kind: "skip";
      reason: string;
    };

export type RoutingResult =
  | { kind: "article_created"; articleId: string; briefId: string }
  | { kind: "cornerstone_spec_created"; cornerstoneSpecId: string; briefId: string }
  | { kind: "translation_created"; articleId: string; briefId: string }
  | { kind: "article_refreshed"; articleId: string; briefId: string }
  | { kind: "skipped"; reason: string; briefId: string };

export class RoutingNotImplementedError extends Error {
  constructor(
    public readonly routingKind: RoutingDecision["kind"],
    reason: string,
  ) {
    super(`Routing kind '${routingKind}' not implemented in 54.3: ${reason}`);
    this.name = "RoutingNotImplementedError";
  }
}
