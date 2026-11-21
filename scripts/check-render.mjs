// Throwaway harness: pulls `render` out of the built file and exercises it.
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../dist/background.js", import.meta.url), "utf8");

// Grab the render() function body from the compiled output so we test the real code.
const start = src.indexOf("function render(");
const end = src.indexOf("\nasync function activeTab");
const render = new Function(`${src.slice(start, end)}; return render;`)();

const checking = (label, input, mode, expected) => {
  const actual = render(input, mode);
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  return ok;
};

let pass = true;
pass = checking("plain url", { url: "https://example.com/x" }, "url", "https://example.com/x") && pass;
pass = checking("brackets escaped", { url: "https://e.com", title: "Docs [beta]" }, "markdown", "[Docs \\[beta\\]](https://e.com)") && pass;
pass = checking("blank title falls back to url", { url: "https://e.com", title: "   " }, "markdown", "[https://e.com](https://e.com)") && pass;
pass = checking("pendingUrl used", { pendingUrl: "https://p.com" }, "url", "https://p.com") && pass;
pass = checking("restricted page -> null", { title: "Settings" }, "url", null) && pass;

await import("node:process").then(({ exit }) => exit(pass ? 0 : 1));
