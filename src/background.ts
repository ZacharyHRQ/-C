/**
 * Quick Copy — background service worker.
 *
 * Three constraints shaped this file. They are the whole reason it is this
 * small, so they are worth stating up front:
 *
 * 1. No host permissions, and no DOM injection.
 *    We never touch the page. `activeTab` — granted automatically by the
 *    keyboard gesture that triggers this code — is all the page access needed.
 *    That removes `<all_urls>`, `tabs` and `scripting` from the manifest, and
 *    with them the "read and change all your data on all websites" install
 *    warning, the CSP failures, and the focus theft caused by injecting a
 *    <textarea> into someone else's document.
 *
 * 2. One clipboard path, not two.
 *    A hidden offscreen document owns the write. It is spawned on first use and
 *    then reused, so every copy after the first is a single message hop rather
 *    than a document spawn. If the offscreen document is gone, we spawn it
 *    again — there is no second code path to keep in sync.
 *
 * 3. Never claim a success we have not verified.
 *    The offscreen document reports the result of the actual clipboard write.
 *    A green check means it returned true; anything else is a red cross.
 */

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

/** Badges are set per tab, so a stale check dies with the tab. */
function clearBadge(tabId: number): Promise<void> {
  return chrome.action.setBadgeText({ tabId, text: "" });
}

async function flashBadge(tabId: number, ok: boolean): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? BADGE_OK : BADGE_FAIL }),
    chrome.action.setBadgeText({ tabId, text: ok ? "\u2713" : "\u2715" }),
  ]);

  // A service worker can be torn down before this fires, leaving the badge up.
  // `clearBadge` at the start of every copy is the backstop for that case.
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

    await flashBadge(tabId, await writeClipboard(payload));
  } catch {
    await flashBadge(tabId, false).catch(() => {});
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  void run(command, tab);
});

// Clicking the toolbar icon does the same thing as the primary shortcut, so the
// extension is discoverable without opening its options.
chrome.action.onClicked.addListener((tab) => {
  void run("copy-url", tab);
});

// Clear any badge text that a torn-down worker left behind.
chrome.runtime.onInstalled.addListener(() => void chrome.action.setBadgeText({ text: "" }));
chrome.runtime.onStartup.addListener(() => void chrome.action.setBadgeText({ text: "" }));
