// Import logging. Reuses the integration engine's redacted debug logger.
// Never logs credentials, request/response bodies or record payloads.

import { logDebug } from "@/lib/integration-engine/logger.server";

export interface ImportEntityLog {
  provider: string;
  integrationId: string;
  entity: string;
  validated: number;
  invalid: number;
  create: number;
  update: number;
  skip: number;
}

export function logImportEntity(entry: ImportEntityLog) {
  // eslint-disable-next-line no-console
  console.log(`[import] ${JSON.stringify(entry)}`);
  logDebug("import-entity", { ...entry });
}

export function logImportSummary(entry: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[import:summary] ${JSON.stringify(entry)}`);
  logDebug("import-summary", { ...entry });
}
