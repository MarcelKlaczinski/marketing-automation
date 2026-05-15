import type { MasterPromptKey } from "@marketing-auto/db";
import { loadActiveConfig } from "./load-active-config.ts";

export async function resolveMasterPrompt(args: {
  projectId: string;
  promptKey: MasterPromptKey;
  fallback: string;
}): Promise<string> {
  const config = await loadActiveConfig(args.projectId);
  const override = config.masterPrompts[args.promptKey];
  return override?.prompt ?? args.fallback;
}
