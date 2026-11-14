import { createTranslate, type Translate } from "./message";
import { source as en } from "./messages/en/source";

/**
 * The English source text and nothing else. A Worker that only writes `sourceText` imports this
 * file, so it does not load the translated catalogs that `source-text.ts` pulls in for
 * `localizeSourceText`.
 */
export type SourceMessages = typeof en;

/** The English text for a source key. Write it where the code threw a literal before. */
export const sourceText: Translate<SourceMessages> = createTranslate({
  source: en,
  locale: "en",
  sourceLocale: "en",
});
