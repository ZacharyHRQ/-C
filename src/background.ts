/**
 * Quick Copy background service worker.
 *
 * The extension holds no host permissions. `activeTab`, granted by the keystroke
 * that fires the command, is enough to read the active tab's URL and to inject
 * the toast.
 *
 * The clipboard write runs in an offscreen document because the async Clipboard
 * API needs a focused document and an offscreen document can never be focused.
 * That document is created once and reused for later copies.
 *
 * `render` returns null on restricted pages, where `activeTab` exposes no URL.
 */

import { showToast } from "./toast.js";

export {};

/** What to put on the clipboard. */
type Mode = "url" | "markdown";

interface CommandSpec {
  readonly mode: Mode;
}

const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  "copy-url": { mode: "url" },
  "copy-as-markdown": { mode: "markdown" },
};

/** How long the result badge stays on screen, in ms. */
const BADGE_TTL_MS = 750;

const BADGE_OK = "#1e8e3e";
const BADGE_FAIL = "#d93025";

const OFFSCREEN_URL = "offscreen.html";

/* -------------------------------------------------------------------------- */
/* Offscreen document                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Concurrent copies would otherwise race to call `createDocument`, and the
 * loser throws "Only a single offscreen document may be created". Sharing one
 * in-flight promise collapses the race.
 */
let spawning: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (spawning) return spawning;

  spawning = (async () => {
    try {
      if (await chrome.offscreen.hasDocument()) return;
    } catch {
      // hasDocument() is Chrome 116+; on anything older just try to create.
    }

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.CLIPBOARD],
        justification: "Write the current tab's URL to the clipboard.",
      });
    } catch (err) {
      // Lost a race with another tab; a document exists, which is fine.
      if (!String(err).includes("Only a single offscreen")) throw err;
    }
  })().finally(() => {
    spawning = null;
  });

  return spawning;
}

/* -------------------------------------------------------------------------- */
/* Clipboard                                                                   */
/* -------------------------------------------------------------------------- */

async function writeClipboard(text: string): Promise<boolean> {
  await ensureOffscreen();
  const reply = (await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "copy",
    text,
  })) as { ok?: boolean } | undefined;

  return reply?.ok === true;
}

/* -------------------------------------------------------------------------- */
/* Badge feedback                                                              */
/* -------------------------------------------------------------------------- */

/** Badges are set per tab, so a stale check disappears with its tab. */
function clearBadge(tabId: number): Promise<void> {
  return chrome.action.setBadgeText({ tabId, text: "" });
}

async function flashBadge(tabId: number, ok: boolean): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? BADGE_OK : BADGE_FAIL }),
    chrome.action.setBadgeText({ tabId, text: ok ? "\u2713" : "\u2715" }),
  ]);

  // A service worker can be torn down before this fires, leaving the badge up.
  // Clearing it at the start of every copy covers that case.
  setTimeout(() => void clearBadge(tabId), BADGE_TTL_MS);
}

/* -------------------------------------------------------------------------- */
/* Payload                                                                     */
/* -------------------------------------------------------------------------- */

function render(tab: chrome.tabs.Tab, mode: Mode): string | null {
  const url = tab.url ?? tab.pendingUrl;
  if (!url) return null; // Restricted page: activeTab cannot see the URL.

  if (mode === "url") return url;

  const title = tab.title?.trim() || url;
  const escaped = title.replace(/([[\]\\])/g, "\\$1");
  return `[${escaped}](${url})`;
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Draws the confirmation pill. Injection is refused on restricted pages, where
 * the badge is the only feedback available.
 */
async function showPageToast(tabId: number, text: string, ok: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showToast,
      args: [text, ok],
    });
  } catch {
    /* badge-only page */
  }
}

/* -------------------------------------------------------------------------- */
/* Flow                                                                        */
/* -------------------------------------------------------------------------- */

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function run(command: string, hinted?: chrome.tabs.Tab): Promise<void> {
  const spec = COMMANDS[command];
  if (!spec) return;

  // The commands API hands us the tab directly, which skips a tabs.query call.
  const tab = hinted?.id !== undefined ? hinted : await activeTab();
  if (tab?.id === undefined) return;

  const tabId = tab.id;

  try {
    await clearBadge(tabId);

    const payload = render(tab, spec.mode);
    if (payload === null) {
      await flashBadge(tabId, false);
      return;
    }

    const ok = await writeClipboard(payload);

    // The badge works everywhere. The toast is skipped where injection fails.
    await Promise.all([flashBadge(tabId, ok), showPageToast(tabId, payload, ok)]);
  } catch {
    await flashBadge(tabId, false).catch(() => {});
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  void run(command, tab);
});

// A toolbar click behaves like the primary shortcut, so the extension can be
// used without knowing the key combination.
chrome.action.onClicked.addListener((tab) => {
  void run("copy-url", tab);
});

// Clear any badge text that a torn-down worker left behind.
chrome.runtime.onInstalled.addListener(() => void chrome.action.setBadgeText({ text: "" }));
chrome.runtime.onStartup.addListener(() => void chrome.action.setBadgeText({ text: "" }));
