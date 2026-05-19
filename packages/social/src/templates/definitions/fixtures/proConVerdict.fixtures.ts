import type { MockFixtureMap } from "../../types.ts";
import type { ProConVerdictContext } from "../proConVerdict.ts";

export const PRO_CON_VERDICT_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "characteristic",
    description: "Loom — vollständige Pros/Cons (DE), reale Verdict-Daten",
    input: {
      toolName: "Loom",
      pros: [
        "Async-Video direkt im Browser, kein Schnitt nötig",
        "Auto-Transkription in 50+ Sprachen",
        "Integriert sich in Slack, Notion, Linear",
        "Saubere Sharing-Links statt Datei-Anhänge",
        "KI-gestützte Zusammenfassung nach dem Upload",
      ],
      cons: [
        "Free-Tier auf 5 Min/Video begrenzt",
        "Editor schwach für längere Tutorials",
        "Keine echte Live-Recording-Option",
        "Teuer für große Teams (Pro ab 15 $/Seat)",
        "Video-Qualität sinkt bei schlechter Verbindung",
      ],
    } satisfies ProConVerdictContext,
  },

  "edge-min": {
    name: "edge-min",
    description: "Minimale Fixtures — genau 3 Pros, 3 Cons (EN), kurze Texte",
    input: {
      toolName: "Tool X",
      pros: [
        "Pro one here",
        "Pro two here",
        "Pro three here",
      ],
      cons: [
        "Con one here",
        "Con two here",
        "Con three here",
      ],
    } satisfies ProConVerdictContext,
  },

  "edge-max": {
    name: "edge-max",
    description: "Maximale Fixtures — 5 Pros, 5 Cons, langer Toolname (EN)",
    input: {
      toolName: "Maximum Length Tool Name That Tests Layout",
      pros: [
        "First pro at maximum allowed character count — testing wrapping at the upper bound",
        "Second pro at maximum allowed character count — testing wrapping at the upper bound",
        "Third pro at maximum allowed character count — testing wrapping at the upper bound",
        "Fourth pro at maximum allowed character count — testing wrapping at upper bound",
        "Fifth pro at maximum allowed character count — testing wrapping at the upper bound",
      ],
      cons: [
        "First con at maximum allowed character count — testing wrapping at the upper bound",
        "Second con at maximum allowed character count — testing wrapping at the upper bound",
        "Third con at maximum allowed character count — testing wrapping at the upper bound",
        "Fourth con at maximum allowed character count — testing wrapping at upper bound",
        "Fifth con at maximum allowed character count — testing wrapping at the upper bound",
      ],
    } satisfies ProConVerdictContext,
  },
};
