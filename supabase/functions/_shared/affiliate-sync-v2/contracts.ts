/** Runtime-neutral HTTP boundary owned by the V2 host. */

export type CredentialDisposition = "attach_if_same_origin" | "omit";
export type RedirectPolicy = "error";

export interface ImpactTransportRequest {
  method: "GET";
  url: string;
  credentialDisposition: CredentialDisposition;
  redirect: RedirectPolicy;
  signal?: AbortSignal;
}

export interface ImpactTransportResponse {
  kind: "response";
  status: number;
  bodyText: string;
  retryAfterMs: number | null;
}

export interface ImpactTransportFailure {
  kind: "transport_error" | "timeout" | "aborted";
  errorCode: string | null;
}

export type ImpactTransportResult = ImpactTransportResponse | ImpactTransportFailure;

/**
 * The host performs network I/O and decides whether its own request metadata
 * may be attached. V2 receives only this credential-free result contract.
 */
export interface ImpactTransport {
  execute(request: ImpactTransportRequest): Promise<ImpactTransportResult>;
  wait(delayMs: number, signal?: AbortSignal): Promise<void>;
}
