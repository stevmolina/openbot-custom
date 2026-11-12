// Runs the real brand layer (`scripts/brand-layer.ts`) the way the Vite builds run it, over every
// `@openbot/i18n` catalog module and every visible literal outside the catalogs, and checks:
// - with `OPENBOT_BRAND_NAME=Pokebots`, no catalog value keeps the product word "OpenBot", except
//   the kept phrases; every key stays; each `openbot.run` and `openbot://` stays;
// - each literal rule and the account defaults of the main process apply;
// - the installable web app gets the Pokebots name and icons, and only the web output changes;
// - with the setting off, the layer gives no Vite plugin, so the builds are the same as without it.
// The catalogs load from a copy of `packages/i18n/src` under `.openbot-build`, with each catalog
// module replaced by the code the plugin gives the bundler.
// `bun scripts/pokebots-brand-e2e.ts`. Writes .openbot-build/pokebots-brand-e2e/report.json.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MessageCatalog } from "../packages/i18n/src/message";
import {
  BRANDED_MODULES,
  brandHtml,
  brandModule,
  brandPlugins,
  brandText,
  LITERAL_RULES,
  readBrandSettings,
  WEB_ICON_FILES,
} from "./brand-layer";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/pokebots-brand-e2e");
const I18N_SOURCE = join(ROOT, "packages/i18n/src");
const MIRROR = join(OUT, "i18n-src");
const BRAND_ENV = {
  OPENBOT_BRAND_NAME: "Pokebots",
  OPENBOT_BRAND_AUTH_API_URL: "https://api.pokebots.xyz",
  OPENBOT_BRAND_SIGNAL_URL: "wss://signal.pokebots.xyz/v1/signal",
};
/** Modules that only join the area modules and hold no keys. */
const JOIN_MODULES = new Set(["index.ts", "mobile.ts", "source.ts", "shared.ts"]);
const KEPT = ["Shared with OpenBot", "OpenBot GitHub App", "OpenBot Mobile", "OpenBot Shared"];

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return Promise.resolve(entry.name.endsWith(".ts") ? [path] : []);
    }),
  );
  return files.flat();
}

function messageValues(messages: MessageCatalog): Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, message] of Object.entries(messages)) {
    if (typeof message === "string") values.set(key, message);
    else if (message && typeof message === "object") {
      for (const [form, text] of Object.entries(message))
        if (typeof text === "string") values.set(`${key}#${form}`, text);
    }
  }
  return values;
}

function count(text: string, word: string): number {
  return text.split(word).length - 1;
}

// 1. Off: no plugin, and no settings.
const off = {
  pluginsWithoutSetting: brandPlugins(ROOT, {}).length,
  pluginsWithBlankSetting: brandPlugins(ROOT, { OPENBOT_BRAND_NAME: "  " }).length,
};
check(off.pluginsWithoutSetting === 0, "The brand layer gives a plugin without OPENBOT_BRAND_NAME.");
check(off.pluginsWithBlankSetting === 0, "The brand layer gives a plugin for a blank OPENBOT_BRAND_NAME.");

// 2. On: the real plugin over every catalog module.
const settings = readBrandSettings(BRAND_ENV);
if (!settings) throw new Error("The brand settings did not read.");
const [plugin] = brandPlugins(ROOT, BRAND_ENV);
if (!plugin) throw new Error("The brand layer gave no plugin.");
const warnings: string[] = [];
const pluginContext = { warn: (message: string) => warnings.push(message) };

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(I18N_SOURCE, MIRROR, { recursive: true });

const catalogFiles = await walk(join(I18N_SOURCE, "messages"));
let transformedModules = 0;
let comparedModules = 0;
let keys = 0;
let valuesBefore = 0;
let valuesBranded = 0;
let wordBefore = 0;
let wordAfter = 0;
const keptPhrases: Record<string, number> = {};
const leftovers: string[] = [];
for (const file of catalogFiles) {
  const code = await readFile(file, "utf8");
  const result = plugin.transform.call(pluginContext, code, file);
  if (result) {
    transformedModules += 1;
    await writeFile(join(MIRROR, relative(I18N_SOURCE, file)), result.code);
  }
}
for (const file of catalogFiles) {
  const name = file.split("/").pop() ?? "";
  if (JOIN_MODULES.has(name)) continue;
  const path = relative(I18N_SOURCE, file);
  const original: { messages?: MessageCatalog } = await import(pathToFileURL(file).href);
  const branded: { messages?: MessageCatalog } = await import(pathToFileURL(join(MIRROR, path)).href);
  if (!original.messages || !branded.messages) {
    failures.push(`${path} has no messages export.`);
    continue;
  }
  comparedModules += 1;
  const before = messageValues(original.messages);
  const after = messageValues(branded.messages);
  keys += Object.keys(original.messages).length;
  check(
    JSON.stringify(Object.keys(original.messages)) === JSON.stringify(Object.keys(branded.messages)),
    `${path}: the keys changed.`,
  );
  for (const [key, text] of before) {
    const result = after.get(key) ?? "";
    valuesBefore += text.includes("OpenBot") ? 1 : 0;
    valuesBranded += result !== text ? 1 : 0;
    wordBefore += count(text, "OpenBot");
    wordAfter += count(result, "OpenBot");
    check(result === brandText(text, settings.name), `${path} ${key}: the value is not the expected branded text.`);
    for (const address of ["openbot.run", "openbot://"]) {
      check(count(result, address) === count(text, address), `${path} ${key}: an ${address} address changed.`);
    }
    let rest = result;
    for (const phrase of KEPT) {
      const found = count(rest, phrase);
      if (found > 0) keptPhrases[phrase] = (keptPhrases[phrase] ?? 0) + found;
      rest = rest.replaceAll(phrase, "");
    }
    if (rest.includes("OpenBot")) leftovers.push(`${path} ${key}: ${result}`);
  }
}
check(leftovers.length === 0, `${leftovers.length} catalog values still show "OpenBot" outside the kept phrases.`);
check(comparedModules > 800, `Only ${comparedModules} catalog modules were compared.`);

// 3. Literals outside the catalogs, the email module, and the account defaults of the main process.
const literalResults: { file: string; find: string; found: boolean }[] = [];
const files = new Set([...LITERAL_RULES.map((rule) => rule.file), ...BRANDED_MODULES]);
const outsideCatalogs: Record<string, { changed: boolean; missing: readonly string[]; openBotLeft: number }> = {};
for (const file of files) {
  const code = await readFile(join(ROOT, file), "utf8");
  for (const rule of LITERAL_RULES.filter((candidate) => candidate.file === file)) {
    literalResults.push({ file, find: rule.find, found: code.includes(rule.find) });
  }
  const result = plugin.transform.call(pluginContext, code, join(ROOT, file));
  outsideCatalogs[file] = {
    changed: result !== null && result.code !== code,
    missing: brandModule(file, code, settings)?.missing ?? [],
    openBotLeft: count(result?.code ?? code, '"OpenBot"'),
  };
  check(result !== null && result.code !== code, `${file}: the brand layer changed nothing.`);
}
for (const literal of literalResults) check(literal.found, `${literal.file}: ${literal.find} is not in the file.`);
check(warnings.length === 0, `The plugin warned: ${warnings.join(" | ")}`);
const mainIndex = await readFile(join(ROOT, "src/main/index.ts"), "utf8");
const mainBranded = brandModule("src/main/index.ts", mainIndex, settings)?.code ?? "";
const accountDefaults = {
  authApiUrl: mainBranded.startsWith('process.env.OPENBOT_AUTH_API_URL ??= "https://api.pokebots.xyz";\n'),
  signalUrl: mainBranded.includes('process.env.OPENBOT_REMOTE_SIGNAL_URL ??= "wss://signal.pokebots.xyz/v1/signal";\n'),
  setNameKept: mainBranded.includes('app.setName("OpenBot");'),
};
check(accountDefaults.authApiUrl, "The main process does not default to the branded account service.");
check(accountDefaults.signalUrl, "The main process does not default to the branded Signal.");
check(accountDefaults.setNameKept, 'app.setName("OpenBot") changed. The data folder and the keychain item need it.');
const withoutUrls = readBrandSettings({ OPENBOT_BRAND_NAME: "Pokebots" });
check(
  withoutUrls !== null && brandModule("src/main/index.ts", mainIndex, withoutUrls)?.code.startsWith("import") === true,
  "The brand name alone adds account defaults.",
);

// 4. The desktop HTML pages.
const html: Record<string, { before: number; after: number }> = {};
for (const name of (await readdir(join(ROOT, "src/renderer"))).filter((file) => file.endsWith(".html"))) {
  const page = await readFile(join(ROOT, "src/renderer", name), "utf8");
  const branded = brandHtml(page, settings);
  html[name] = { before: count(page, ">OpenBot"), after: count(branded, ">OpenBot") };
  check(!branded.includes(">OpenBot"), `src/renderer/${name} still shows OpenBot.`);
}

// 5. The installable web app: the plugin brands a copy of the Worker's static files after a build
// writes them, and leaves an output folder without a manifest alone.
const webOut = join(OUT, "web-client");
await cp(join(ROOT, "apps/auth-api/public"), webOut, { recursive: true });
const workerOut = join(OUT, "worker");
await mkdir(workerOut, { recursive: true });
plugin.writeBundle.call(pluginContext, { dir: webOut });
plugin.writeBundle.call(pluginContext, { dir: workerOut });
const manifest = await readFile(join(webOut, "site.webmanifest"), "utf8");
const manifestHas = (field: string, value: string) =>
  manifest.includes(`${JSON.stringify(field)}: ${JSON.stringify(value)}`);
check(
  manifestHas("name", "Pokebots") && manifestHas("short_name", "Pokebots"),
  "The web app manifest keeps the OpenBot name.",
);
check(manifestHas("start_url", "/app"), "The web app manifest lost its start URL.");
const webIcons: Record<string, boolean> = {};
for (const file of WEB_ICON_FILES) {
  const [built, brand] = await Promise.all([
    readFile(join(webOut, file)),
    readFile(join(ROOT, "build/custom/web", file)),
  ]);
  webIcons[file] = built.equals(brand);
  check(webIcons[file], `The web app ${file} is not the Pokebots icon.`);
}
check((await readdir(workerOut)).length === 0, "The brand layer wrote into an output folder without a web app.");
const web = { manifest: JSON.parse(manifest), icons: webIcons };

const report = {
  passed: failures.length === 0,
  failures,
  off,
  settings,
  catalogs: {
    files: catalogFiles.length,
    transformedModules,
    comparedModules,
    keys,
    valuesWithOpenBot: valuesBefore,
    valuesBranded,
    productWordBefore: wordBefore,
    productWordAfter: wordAfter,
    keptPhrases,
    leftovers: leftovers.slice(0, 50),
  },
  literals: literalResults,
  outsideCatalogs,
  accountDefaults,
  html,
  web,
};
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await rm(MIRROR, { recursive: true, force: true });
const summary = { passed: report.passed, failures, catalogs: { ...report.catalogs, leftovers: undefined } };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nReport: ${relative(ROOT, join(OUT, "report.json"))}\n`);
if (!report.passed) process.exit(1);
