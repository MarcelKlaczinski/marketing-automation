export interface LocaleContext {
  locales: string[];
  isMultiLocale: boolean;
  primaryLocale: string;
  searchEngines: string[];
  audienceDescriptors: string[];
  minSearchVolumePerLocale: number;
  /** DataForSEO location codes per locale, in the same order as `locales` */
  locationCodes: number[];
  /** DataForSEO language codes per locale, in the same order as `locales` */
  languageCodes: string[];
}

const LOCALE_METADATA: Record<
  string,
  {
    searchEngine: string;
    audienceDescriptor: string;
    countryCode: string;
    locationCode: number;
    languageCode: string;
  }
> = {
  "de-DE": {
    searchEngine: "Google.de",
    audienceDescriptor: "German-speaking DACH professionals",
    countryCode: "DE",
    locationCode: 2276,
    languageCode: "de",
  },
  "en-US": {
    searchEngine: "Google.com",
    audienceDescriptor: "English-speaking international professionals",
    countryCode: "US",
    locationCode: 2840,
    languageCode: "en",
  },
  "en-GB": {
    searchEngine: "Google.co.uk",
    audienceDescriptor: "English-speaking UK professionals",
    countryCode: "GB",
    locationCode: 2826,
    languageCode: "en",
  },
};

export function buildLocaleContext(targetLocales: string[]): LocaleContext {
  if (targetLocales.length === 0) {
    return {
      locales: ["en-US"],
      isMultiLocale: false,
      primaryLocale: "en-US",
      searchEngines: ["Google.com"],
      audienceDescriptors: ["General professional audience"],
      minSearchVolumePerLocale: 50,
      locationCodes: [2840],
      languageCodes: ["en"],
    };
  }

  const known = targetLocales.filter((l) => l in LOCALE_METADATA);

  if (known.length === 0) {
    return {
      locales: targetLocales,
      isMultiLocale: false,
      primaryLocale: targetLocales[0]!,
      searchEngines: ["Google.com"],
      audienceDescriptors: ["General professional audience"],
      minSearchVolumePerLocale: 50,
      locationCodes: [2840],
      languageCodes: ["en"],
    };
  }

  return {
    locales: known,
    isMultiLocale: known.length > 1,
    primaryLocale: known[0]!,
    searchEngines: known.map((l) => LOCALE_METADATA[l]!.searchEngine),
    audienceDescriptors: known.map((l) => LOCALE_METADATA[l]!.audienceDescriptor),
    minSearchVolumePerLocale: 50,
    locationCodes: known.map((l) => LOCALE_METADATA[l]!.locationCode),
    languageCodes: known.map((l) => LOCALE_METADATA[l]!.languageCode),
  };
}

/**
 * Infer DataForSEO location/language codes from a competitor's domain TLD.
 * Used by FetchCompetitorKeywordsStep to route each domain to the right index.
 */
export function localeFromDomain(
  domain: string,
  fallback: LocaleContext
): { locationCode: number; languageCode: string } {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  if (tld === "de" || tld === "at" || tld === "ch") {
    return { locationCode: 2276, languageCode: "de" };
  }
  if (tld === "co" && domain.endsWith(".co.uk")) {
    return { locationCode: 2826, languageCode: "en" };
  }
  if (tld === "uk") {
    return { locationCode: 2826, languageCode: "en" };
  }
  // .com / .ai / .io / .net / .org → US index
  if (["com", "ai", "io", "net", "org", "app", "dev"].includes(tld)) {
    return { locationCode: 2840, languageCode: "en" };
  }
  // Fall back to primary locale of the project
  return {
    locationCode: fallback.locationCodes[0] ?? 2276,
    languageCode: fallback.languageCodes[0] ?? "de",
  };
}
