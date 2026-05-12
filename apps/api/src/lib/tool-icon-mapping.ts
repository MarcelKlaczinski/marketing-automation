/**
 * Maps toolwiki article slugs to @lobehub/icons-static-png icon slugs.
 * Only list slugs that differ from the lobe-icons name. Identical slugs
 * are resolved automatically by the brand-asset-service fallback path.
 */
export const TOOL_SLUG_TO_LOBE: Record<string, string> = {
  // OpenAI product family → openai brand icon
  chatgpt: "openai",
  "gpt-4": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "dall-e": "openai",
  "dall-e-3": "openai",
  "dalle": "openai",
  "sora": "openai",
  "openai-o1": "openai",
  "openai-o3": "openai",

  // Anthropic product family → claude brand icon
  "claude-ai": "claude",
  "claude-3": "claude",
  "claude-3-5": "claude",
  "claude-opus": "claude",
  "claude-sonnet": "claude",
  "claude-haiku": "claude",

  // Google product family → gemini brand icon
  "gemini-ai": "gemini",
  "bard": "gemini",
  "google-bard": "gemini",

  // GitHub Copilot
  "github-copilot": "githubcopilot",
  "copilot": "githubcopilot",

  // Image generators
  "stable-diffusion": "stablediffusion",
  "stable-diffusion-xl": "stablediffusion",
  "sdxl": "stablediffusion",
  "stable-diffusion-3": "stablediffusion",

  // Leonardo AI
  "leonardo": "leonardoai",
  "leonardo-ai": "leonardoai",

  // Adobe Firefly
  "adobe-firefly": "adobefirefly",
  "firefly": "adobefirefly",

  // ElevenLabs
  "elevenlabs": "elevenlabs",
  "eleven-labs": "elevenlabs",

  // HuggingFace
  "hugging-face": "huggingface",
  "hf": "huggingface",

  // LangChain
  "langchain": "langchain",
  "lang-chain": "langchain",

  // Cohere
  "cohere-ai": "cohere",
  "command-r": "cohere",
};
