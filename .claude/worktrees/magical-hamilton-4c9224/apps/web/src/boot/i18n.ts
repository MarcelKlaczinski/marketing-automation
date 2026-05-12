import messages from "src/i18n";
import { createI18n } from "vue-i18n";
import { defineBoot } from "#q-app/wrappers";

export type MessageLanguages = keyof typeof messages;
export type MessageSchema = (typeof messages)["de"];

declare module "vue-i18n" {
  export interface DefineLocaleMessage extends MessageSchema {}
  export interface DefineDateTimeFormat {}
  export interface DefineNumberFormat {}
}

export default defineBoot(({ app }) => {
  const i18n = createI18n<{ message: MessageSchema }, MessageLanguages>({
    locale: "de",
    fallbackLocale: "de",
    legacy: false,
    messages,
  });

  app.use(i18n);
});
