/**
 * Offscreen document — the only place in the extension that touches a clipboard.
 *
 * Why a hidden document at all: MV3 service workers have no DOM, and the async
 * `navigator.clipboard` API refuses to write from a document that is not focused.
 * Offscreen documents can never be focused, so that route is a dead end here.
 * `document.execCommand("copy")` has no focus requirement and works because the
 * extension holds `clipboardWrite` — which is also why it still functions after
 * the browser deprecated it for normal web pages.
 */

export {};

interface CopyMessage {
  target?: string;
  type?: string;
  text?: string;
}

function copy(text: string): boolean {
  const host = document.body ?? document.documentElement;

  // Reserve the current selection so a stray focus() does not move it.
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none";

  let ok = false;
  try {
    host.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } finally {
    area.remove();
  }

  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }

  return ok;
}

chrome.runtime.onMessage.addListener((message: CopyMessage, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "copy") return;

  // Respond synchronously so the worker knows the real outcome, not a guess.
  sendResponse({ ok: copy(message.text ?? "") });
});
