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

/**
 * Embedded frames need verified clipboard read-back; legacy execCommand may
 * report success even when the OS clipboard was never updated.
 * If read-back is denied/unavailable, fail closed and offer manual selection.
 */
export async function copyWithVerification(
  text: string,
  transport: {
    writeText?: (value: string) => Promise<void>;
    readText?: () => Promise<string>;
  },
): Promise<boolean> {
  if (!text || !transport.writeText || !transport.readText) return false;
  try {
    await transport.writeText(text);
    return (await transport.readText()) === text;
  } catch {
    return false;
  }
}

export function isEmbeddedFrame(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function copyUsingSelection(text: string): boolean {
  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
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
  const writeText =
    clipboard && typeof clipboard.writeText === "function"
      ? (value: string) => clipboard.writeText(value)
      : undefined;

  if (isEmbeddedFrame()) {
    // Do not trust execCommand's success flag inside a sandboxed iframe.
    return copyWithVerification(text, {
      writeText,
      readText:
        clipboard && typeof clipboard.readText === "function"
          ? () => clipboard.readText()
          : undefined,
    });
  }

  // Preserve the already verified working behavior in standalone browsers.
  return copyWithFallback(text, { writeText, legacyCopy: copyUsingSelection });
}
