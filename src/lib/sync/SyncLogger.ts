// Sync logging. Reuses the integration engine's redacted debug logger.
// Never logs credentials, request bodies, or response bodies.

import { logDebug } from "@/lib/integration-engine/logger.server";
import type { SyncEntityType } from "./SyncOptions";

export interface SyncPageLog {
  provider: string;
  integrationId: string;
  entity: SyncEntityType;
  page: number;
  requests: number;
  fetched: number;
  normalized: number;
  skipped: number;
  durationMs: number;
  outcome: "success" | "failure";
  message?: string;
}

export function logSyncPage(entry: SyncPageLog) {
  // eslint-disable-next-line no-console
  console.log(`[sync] ${JSON.stringify(entry)}`);
  logDebug("sync-page", { ...entry });
}

export function logSyncSummary(entry: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[sync:summary] ${JSON.stringify(entry)}`);
  logDebug("sync-summary", { ...entry });
}
