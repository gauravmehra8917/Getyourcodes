// Final output of an import run (preview or committed).

import type { ImportPlan } from "./ImportPlan.ts";
import type { ImportStatistics } from "./ImportStatistics.ts";
import type { PublishingSummary } from "../publishing-policy/types.ts";
import type { IdentityDiagnostics } from "./IdentityDiagnostics.ts";

export interface ImportResult {
  provider: string;
  integrationId: string;
  preview: boolean;
  committed: boolean;
  startedAt: string;
  finishedAt: string;
  plan: ImportPlan;
  statistics: ImportStatistics;
  /** Publishing policy outcome, null when no policy was supplied. */
  publishing: PublishingSummary | null;
  /** Preview-only normalized-offer identity accounting, captured before policy. */
  identityDiagnostics: IdentityDiagnostics | null;
  /** Rotation cursors to persist after a committed run. */
  rotationCursors: Record<string, number>;
  /** Non-fatal problems, e.g. skipped records or validation failures. */
  warnings: string[];
  /** Fatal problems. A non-empty list with committed=false means rollback. */
  errors: string[];
}
