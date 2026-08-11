// Authentication layer: builds request auth (headers + query) from
// the configured authentication type and decrypted credentials.
// Provider-agnostic. Never logs or returns raw secrets.

export { applyAuthentication, type AppliedAuth } from "./authentication";
