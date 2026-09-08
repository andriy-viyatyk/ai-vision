import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL("../src/dom/ui-highlight.js", import.meta.url);
const generatedUrl = new URL("../src/dom/highlight-source.generated.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
await writeFile(
  generatedUrl,
  `export const highlightOverlaySource: string = ${JSON.stringify(source)};\n`,
  "utf8",
);

