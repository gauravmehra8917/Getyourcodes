// The Edge deployment includes only supabase/, so this boundary reaches the
// authoritative runtime-neutral core without importing application source.
export {
  IntegrationEngine,
  validateConfig,
  executeRequest,
  runHealthCheck,
  mapIntegrationConfig,
  ProviderFactory,
  resolveProviderKey,
  NormalizerFactory,
  SyncContext,
  SyncEngine,
  prepareImportPreview,
  projectPreviewSyncRunReport,
  mapPolicyRow,
  FALLBACK_POLICY,
} from "../_shared/affiliate-sync-core/index.ts";
