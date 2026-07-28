// Final output of an import run (preview or committed).

import type { ImportPlan } from "./ImportPlan";
import type { ImportStatistics } from "./ImportStatistics";

export interface ImportResult {
  provider: string;
  integrationId: string;
  preview: boolean;
  committed: boolean;
  startedAt: string;
  finishedAt: string;
  plan: ImportPlan;
  statistics: ImportStatistics;
  /** Non-fatal problems, e.g. skipped records or validation failures. */
  warnings: string[];
  /** Fatal problems. A non-empty list with committed=false means rollback. */
  errors: string[];
}
