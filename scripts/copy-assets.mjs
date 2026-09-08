import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("..", import.meta.url);
await mkdir(new URL("../dist/dom", import.meta.url), { recursive: true });
await copyFile(new URL("../src/dom/ui-highlight.js", import.meta.url), new URL("../dist/dom/ui-highlight.js", import.meta.url));
await copyFile(new URL("../src/dom/ui-highlight.d.ts", import.meta.url), new URL("../dist/dom/ui-highlight.d.ts", import.meta.url));

