import {
  IntegrationEngine,
  NormalizerFactory,
  ProviderFactory,
  SyncContext,
  SyncEngine,
  executeRequest,
  prepareImportPreview,
  projectPreviewSyncRunReport,
  validateConfig,
} from "./import-boundary.ts";

Deno.test("affiliate-sync-preview directly reuses runtime-neutral source", () => {
  const exports = [
    IntegrationEngine, NormalizerFactory, ProviderFactory, SyncContext, SyncEngine,
    executeRequest, prepareImportPreview, projectPreviewSyncRunReport, validateConfig,
  ];
  if (exports.some((value) => typeof value !== "function")) {
    throw new Error("The direct Edge source boundary did not resolve a runtime-neutral export");
  }
});
