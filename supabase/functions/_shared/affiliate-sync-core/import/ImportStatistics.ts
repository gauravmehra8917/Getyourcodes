// Import run statistics. Purely descriptive; no provider knowledge.

export interface ImportStatistics {
  provider: string;
  integrationId: string;
  validated: number;
  created: number;
  updated: number;
  skipped: number;
  validationFailures: number;
  duplicates: number;
  durationMs: number;
  transactionMs: number;
}

export function emptyImportStatistics(provider: string, integrationId: string): ImportStatistics {
  return {
    provider,
    integrationId,
    validated: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    validationFailures: 0,
    duplicates: 0,
    durationMs: 0,
    transactionMs: 0,
  };
}
