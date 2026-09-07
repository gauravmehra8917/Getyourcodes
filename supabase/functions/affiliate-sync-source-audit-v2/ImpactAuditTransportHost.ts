import type {
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../_shared/affiliate-sync-v2/contracts.ts";
import {
  type HostFetchV2,
  type HostWaitV2,
  ImpactTransportHost,
} from "../_shared/affiliate-sync-v2-host/ImpactTransportHost.ts";
import type { ImpactHostCredentialsV2 } from "../_shared/affiliate-sync-v2-host/types.ts";
import type { ImpactAuditTransportV2, ImpactRateSnapshotV2 } from "./types.ts";

export const AUDIT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const RATE_HEADERS = {
  limit: ["X-RateLimit-Limit", "X-RateLimit-Limit-Hour"],
  remaining: ["X-RateLimit-Remaining", "X-RateLimit-Remaining-Hour"],
  reset: ["X-RateLimit-Reset", "X-RateLimit-Reset-Hour"],
} as const;

function nonnegativeHeaderInteger(
  headers: Headers,
  names: readonly string[],
): { present: boolean; value: number | null } {
  let present = false;
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null) continue;
    present = true;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return { present: true, value: parsed };
    }
  }
  return { present, value: null };
}

async function boundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseSizeLimitError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

class ResponseSizeLimitError extends Error {}

function statusPermitsBody(status: number): boolean {
  return status !== 101 && status !== 204 && status !== 205 && status !== 304;
}

/**
 * Audit-only adapter around the settled Impact transport. It keeps all
 * credential/origin/header/redirect behavior and adds a hard body-read cap plus
 * fixed numeric rate-header observations.
 */
export class ImpactAuditTransportHost implements ImpactAuditTransportV2 {
  private readonly inner: ImpactTransportHost;
  private rate: ImpactRateSnapshotV2 = {
    limit: null,
    remaining: null,
    reset: null,
  };
  private responseSizeLimitExceeded = false;

  constructor(input: {
    credentials: ImpactHostCredentialsV2;
    approvedCredentialOrigin: string;
    fetchImplementation?: HostFetchV2;
    waitImplementation?: HostWaitV2;
    now?: () => number;
    maxResponseBytes?: number;
  }) {
    const fetchImplementation = input.fetchImplementation ?? fetch;
    const maxResponseBytes = input.maxResponseBytes ?? AUDIT_MAX_RESPONSE_BYTES;
    this.inner = new ImpactTransportHost({
      credentials: input.credentials,
      approvedCredentialOrigin: input.approvedCredentialOrigin,
      waitImplementation: input.waitImplementation,
      now: input.now,
      fetchImplementation: async (request, init) => {
        const response = await fetchImplementation(request, init);
        this.observeRate(response.headers);
        if (response.redirected) return response;
        try {
          const body = await boundedResponseBody(response, maxResponseBytes);
          return new Response(
            statusPermitsBody(response.status) ? body : null,
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            },
          );
        } catch (error) {
          this.responseSizeLimitExceeded = error instanceof
            ResponseSizeLimitError;
          throw new Error("audit_bounded_body_read_failed");
        }
      },
    });
  }

  private observeRate(headers: Headers): void {
    for (const key of ["limit", "remaining", "reset"] as const) {
      const observed = nonnegativeHeaderInteger(headers, RATE_HEADERS[key]);
      if (observed.present) this.rate[key] = observed.value;
    }
  }

  execute(request: ImpactTransportRequest): Promise<ImpactTransportResult> {
    this.responseSizeLimitExceeded = false;
    return this.inner.execute(request);
  }

  wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    return this.inner.wait(delayMs, signal);
  }

  readRateSnapshot(): ImpactRateSnapshotV2 {
    return { ...this.rate };
  }

  resetRateSnapshot(): void {
    this.rate = { limit: null, remaining: null, reset: null };
  }

  consumeResponseSizeLimitExceeded(): boolean {
    const exceeded = this.responseSizeLimitExceeded;
    this.responseSizeLimitExceeded = false;
    return exceeded;
  }
}
