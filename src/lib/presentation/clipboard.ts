/** Copy a coupon code, with a graceful fallback for embedded previews. */
export type CopyTransport = {
  writeText?: (value: string) => Promise<void>;
  legacyCopy: (value: string) => boolean;
};

/** Returns true only when the browser reports a successful copy operation. */
export async function copyWithFallback(text: string, transport: CopyTransport): Promise<boolean> {
  if (!text) return false;

  if (transport.writeText) {
    try {
      await transport.writeText(text);
      return true;
    } catch {
      // Some embedded previews block navigator.clipboard; try the selection fallback.
    }
  }

  try {
    return transport.legacyCopy(text) === true;
  } catch {
    return false;
  }
}

function copyUsingSelection(text: string): boolean {
  if (typeof document === "undefined" || !document.body || typeof document.execCommand !== "function") {
    return false;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.opacity = "0";

  const previousFocus = document.activeElement;
  document.body.appendChild(input);
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } finally {
    input.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}

/** No analytics, redirects, or mutations: client-side clipboard only. */
export function copyCouponCode(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return copyWithFallback(text, {
    writeText:
      clipboard && typeof clipboard.writeText === "function"
        ? (value) => clipboard.writeText(value)
        : undefined,
    legacyCopy: copyUsingSelection,
  });
}
