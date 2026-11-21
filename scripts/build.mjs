/**
 * Assembles dist/ into a folder Chrome can load unpacked.
 *
 * tsc already emits the JS straight into dist/ (rootDir: src), so this only
 * copies the non-TypeScript assets. No bundler, no dependency tree to audit.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

await mkdir(dist, { recursive: true });

// Manifest: copied verbatim, then validated for the one mistake that silently
// breaks a build — an icon path that does not exist in dist/.
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
