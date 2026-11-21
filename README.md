# Quick Copy

A Chrome extension that puts the current tab's URL on your clipboard with one keystroke. No popup, no toolbar fiddling, no page injection.

`⌘⇧C` → copy URL · `⌘⇧M` → copy `[Page title](url)` · green `✓` appears on the icon for 750 ms.

This is a lean reimplementation of [Ctrl_Shift_C](https://github.com/TheTahsinShahriar/Ctrl_Shift_C) with a different set of tradeoffs — see [Design notes](#design-notes).

## Install

```sh
npm install
npm run build
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this repo's `dist/` folder.

And install shows **no permission warning**: the manifest requests no host permissions at all.

Rebind the keys at `chrome://extensions/shortcuts`.

## Why not Rust

A Chrome extension is not a binary. Chrome loads a manifest plus JS/HTML/CSS and nothing else — there is no slot to put a native executable in, and no `chrome.*` API bridge for one.

The only way to "use Rust" here is to compile it to WebAssembly and ship it alongside JS glue. That means paying roughly 100 KB of `.wasm` plus a JS shim to eventually call one line of DOM clipboard API. The entire extension as it stands is **4 KB of JS**. WASM would make it ~25× bigger and add a compile step and a fetch of the module on every service-worker start, in exchange for zero work Rust is uniquely good at.

So Rust is genuinely the wrong tool for this product. The performance win in a copy-URL extension isn't instruction throughput — it's how many Chrome round-trips and processes you touch per keystroke, and that's an architecture question. TypeScript with `strict` on and no runtime dependencies gives you the same 4 KB with types that catch the actual bugs (see below).

**Where Rust does make sense:** if you want a *native* macOS tool instead — a menu-bar app, a global-hotkey daemon, or something that also grabs the URL from Safari and Arc. That's a different product, and Rust (or Swift) would be the right call. Happy to build that instead.

## What's in the box

```
quick-copy/
├── manifest.json          # MV3, 3 permissions, no host access
├── src/
│   ├── background.ts      # service worker: shortcut → payload → clipboard → badge
│   └── offscreen.ts       # the only clipboard write in the codebase
├── static/offscreen.html  # hidden document host
├── icons/                 # icon.svg + 16/48/128 PNGs
├── scripts/
│   ├── build.mjs          # copies assets into dist/, validates icon paths
│   └── check-render.mjs   # tests the payload formatting against dist/
└── dist/                  # ← load this in Chrome
```

## Design notes

### One clipboard path instead of two

The usual approach (and the one in the original) is: try injecting a `<textarea>` into the page, and fall back to an offscreen document when that fails. Two code paths, two failure modes, two things to keep in sync.

Injecting into the page costs you: an `executeScript` IPC round-trip, a mutation of the user's DOM, stolen focus and selection, and a hard failure on any site with a strict CSP or no `<body>`. In exchange it saves maybe 10 ms.

This version skips injection entirely. A hidden offscreen document does the write, created on first use and reused afterwards, so the first copy pays a document spawn and every copy after that is one message hop. Fewer moving parts, works identically on every page, and no page ever knows the extension was there.

### `activeTab` instead of `<all_urls>`

`activeTab` is granted by the same keystroke that triggers the command, so the extension can read the active tab's URL without requesting standing access to every site you visit. That removes the "read and change all your data on all websites" install warning, plus the `tabs` and `scripting` permissions.

The cost: `activeTab` does not cover restricted pages, so `chrome://` tabs get a red `✕` instead of a URL. That's the one thing the original does that this doesn't. If you want it back, add `"tabs"` to `permissions` in `manifest.json` and rebuild — it costs a "read your browsing history" warning and nothing else, since no code changes are needed.

### Feedback you can trust

The service worker asks the offscreen document for the actual result of the clipboard write and only shows `✓` if it got `true` back. There is no path in this codebase where a success badge appears without a confirmed write.

Badges are set per tab ID, so a stale `✓` is destroyed along with the tab it belonged to. As a second backstop, every invocation clears the badge before it starts, and the badge is cleared on install and browser startup in case a worker was torn down mid-timer.

### The race that bites everyone

`chrome.offscreen.createDocument()` throws `Only a single offscreen document may be created` if two tabs fire the shortcut close together. Both callers share one in-flight promise, and the error is swallowed when it's that specific one — because a document existing is the outcome we wanted anyway.

## Honest comparison

| | Ctrl_Shift_C | Quick Copy |
|---|---|---|
| Runtime JS | ~1.6 KB | ~4.0 KB |
| Permissions | 4 | 3 |
| Host permissions | `<all_urls>` | **none** |
| Install warning | "read and change all your data on all websites" | none |
| Mutates page DOM | yes (injects `<textarea>`) | no |
| Works on `chrome://` | yes | no (one-line opt-in) |
| Copy confirmation | not implemented in source | implemented |
| Build step | none | `tsc` |

It is not smaller — the original is tiny and skips things like verified feedback. It is smaller in *trust surface*: no host permissions, no page access, and a third of the code paths. Roughly 40 lines per file.

## Verifying

```sh
npm run typecheck   # strict tsc, no emit
npm run build
node scripts/check-render.mjs
```

Manual check: load `dist/`, press `⌘⇧C` on a normal page, paste. Then try a `chrome://` page and confirm you get `✕` rather than a false `✓`.

## License

GPL-3.0, matching the project this reimplements. No code was copied from it — the architecture is deliberately different.
