/**
 * Assembles dist/ into a folder Chrome can load unpacked.
 *
 * tsc already emits the JS into dist/ (rootDir: src), so this copies only the
 * non-TypeScript assets.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

await mkdir(dist, { recursive: true });

// Copy the manifest, then check that every icon it references exists in dist/.
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await writeFile(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

await cp(join(root, "static"), dist, { recursive: true });
await cp(join(root, "icons"), join(dist, "icons"), { recursive: true });

for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  try {
    await readFile(join(dist, path));
  } catch {
    throw new Error(`manifest.json points at ${path} (${size}px) but it is not in dist/`);
  }
}

console.log("built dist/");
