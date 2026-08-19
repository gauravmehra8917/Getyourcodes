import type {
  ImpactTransport,
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../_shared/affiliate-sync-v2/index.ts";
import type { ImpactHostCredentialsV2 } from "./types.ts";

export type HostFetchV2 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type HostWaitV2 = (
  delayMs: number,
  signal?: AbortSignal,
) => Promise<void>;

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs: number,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds)
      ? Math.max(0, Math.floor(seconds * 1_000))
      : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, parsed - nowMs) : null;
}

export function waitWithAbort(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, delayMs));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorName(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

/** Host-only authenticated transport. Its failures never include exception text. */
export class ImpactTransportHost implements ImpactTransport {
  private readonly authorization: string;
  private readonly approvedCredentialOrigin: string;
  private readonly fetchImplementation: HostFetchV2;
  private readonly waitImplementation: HostWaitV2;
  private readonly now: () => number;

  constructor(input: {
    credentials: ImpactHostCredentialsV2;
    approvedCredentialOrigin: string;
    fetchImplementation?: HostFetchV2;
    waitImplementation?: HostWaitV2;
    now?: () => number;
  }) {
    this.authorization = `Basic ${
      utf8Base64(
        `${input.credentials.accountSid}:${input.credentials.authToken}`,
      )
    }`;
    this.approvedCredentialOrigin =
      new URL(input.approvedCredentialOrigin).origin;
    this.fetchImplementation = input.fetchImplementation ?? fetch;
    this.waitImplementation = input.waitImplementation ?? waitWithAbort;
    this.now = input.now ?? Date.now;
  }

  async execute(
    request: ImpactTransportRequest,
  ): Promise<ImpactTransportResult> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { kind: "transport_error", errorCode: "invalid_request_url" };
    }
    const headers = new Headers({
      Accept: "application/json",
      "IR-Version": "15",
    });
    if (request.credentialDisposition === "attach_if_same_origin") {
      if (url.origin !== this.approvedCredentialOrigin) {
        return {
          kind: "transport_error",
          errorCode: "credential_origin_mismatch",
        };
      }
      headers.set("Authorization", this.authorization);
    }

    try {
      const response = await this.fetchImplementation(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: request.signal,
      });
      if (response.redirected) {
        return { kind: "transport_error", errorCode: "redirect_rejected" };
      }
      return {
        kind: "response",
        status: response.status,
        bodyText: await response.text(),
        retryAfterMs: parseRetryAfterMs(
          response.headers.get("Retry-After"),
          this.now(),
        ),
      };
    } catch (error) {
      if (errorName(error) === "TimeoutError") {
        return { kind: "timeout", errorCode: "request_timeout" };
      }
      if (request.signal?.aborted || errorName(error) === "AbortError") {
        return { kind: "aborted", errorCode: "request_aborted" };
      }
      return { kind: "transport_error", errorCode: "fetch_failed" };
    }
  }

  wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    return this.waitImplementation(delayMs, signal);
  }
}
