/**
 * Spec 65.4 — Hook variable substitution.
 *
 * Pure function — given a `{variable}`-placeholder pattern + a values map,
 * return the rendered string. Throws on missing variables so a broken
 * Hook-Picker run fails loudly rather than producing `"… wegen {tool}"`
 * in a published carousel slide.
 *
 * Placeholders use `{snake_case}` or `{camelCase}` — anything matching
 * `/\{(\w+)\}/`. The Hook-Picker's `variables` jsonb on each `hook_templates`
 * row declares the placeholder names a pattern expects; the migration
 * `0116_hook_templates_seed.sql` keeps them in sync.
 */

export class HookRenderError extends Error {
  constructor(
    message: string,
    public readonly pattern: string,
    public readonly missingVariable: string,
  ) {
    super(message);
    this.name = "HookRenderError";
  }
}

/**
 * Substitute `{variable}` placeholders in a hook pattern.
 *
 * @throws {HookRenderError} when the pattern references a variable that is
 *   not present in `variables`. Empty-string values are permitted; only
 *   `undefined` (key not in the map) triggers the error.
 *
 * @example
 *   renderHook("Ich habe meinen {profession}-Job verloren — wegen {tool}", {
 *     profession: "Texter",
 *     tool: "Claude",
 *   });
 *   // → "Ich habe meinen Texter-Job verloren — wegen Claude"
 */
export function renderHook(pattern: string, variables: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) {
      throw new HookRenderError(
        `Hook pattern references {${key}} but no value provided`,
        pattern,
        key,
      );
    }
    return value;
  });
}
