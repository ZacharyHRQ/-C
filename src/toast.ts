/**
 * The confirmation toast.
 *
 * `chrome.scripting.executeScript` serialises this function and rebuilds it in
 * the page from its source text, so it cannot reference anything from module
 * scope. Everything it needs is defined inside its own body.
 *
 * It runs in the extension's isolated world, which has its own globals but shares
 * the page's DOM. A closed shadow root keeps page CSS out and stops these styles
 * from leaking into the page.
 */

export function showToast(text: string, ok: boolean): void {
  const KEY = "__quickCopyToast";
  const store = globalThis as unknown as Record<string, unknown>;

  // A second copy before the first toast faded replaces it instead of stacking.
  const prior = store[KEY] as { host: HTMLElement; timer: number } | undefined;
  if (prior) {
    clearTimeout(prior.timer);
    prior.host.remove();
    delete store[KEY];
  }

  const host = document.createElement("div");
  host.setAttribute("aria-live", "polite");
  host.style.cssText = [
    "all:initial",
    "position:fixed",
    "left:50%",
    "bottom:24px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "pointer-events:none",
    "display:block",
  ].join(";");

  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      box-sizing: border-box;
      max-width: min(560px, calc(100vw - 32px));
      padding: 11px 16px 11px 12px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, .09);
      background: #171a1f;
      color: #eef1f4;
      font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      box-shadow: 0 10px 34px rgba(0, 0, 0, .34), 0 3px 8px rgba(0, 0, 0, .22);
      animation: qc-in 200ms cubic-bezier(.2, .9, .3, 1) both;
    }
    .toast.out { animation: qc-out 220ms ease-in both; }
    .mark {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #1e8e3e;
      color: #fff;
    }
    .toast.bad .mark { background: #d93025; }
    .mark svg { width: 11px; height: 11px; display: block; }
    .label { flex: 0 0 auto; color: #fff; font-weight: 600; letter-spacing: -.01em; }
    .text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #9aa4b2;
      font: 500 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      direction: ltr;
      unicode-bidi: plaintext;
    }
    @keyframes qc-in {
      from { opacity: 0; transform: translateY(8px) scale(.97); }
      to   { opacity: 1; transform: none; }
    }
    @keyframes qc-out {
      to { opacity: 0; transform: translateY(6px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast, .toast.out { animation-duration: 1ms; }
    }
  `;

  const toast = document.createElement("div");
  toast.className = ok ? "toast" : "toast bad";
  toast.setAttribute("role", "status");

  const mark = document.createElement("span");
  mark.className = "mark";
  mark.innerHTML = ok
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = ok ? "Copied" : "Couldn't copy";

  const detail = document.createElement("span");
  detail.className = "text";
  // A URL is untrusted input, so it goes in as text rather than markup.
  detail.textContent = text;

  toast.append(mark, label, detail);
  root.append(style, toast);
  document.documentElement.appendChild(host);

  const timer = window.setTimeout(() => {
    toast.classList.add("out");
    window.setTimeout(() => {
      host.remove();
      if (store[KEY]) delete store[KEY];
    }, 240);
  }, 2000);

  store[KEY] = { host, timer };
}
