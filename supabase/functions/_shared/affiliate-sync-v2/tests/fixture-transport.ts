import type {
  ImpactTransport,
  ImpactTransportRequest,
  ImpactTransportResult,
} from "../contracts.ts";

export interface FixtureTransportStep {
  result: ImpactTransportResult;
  expectedUrl?: string;
  expectedCredentialDisposition?: ImpactTransportRequest["credentialDisposition"];
}

/** Deterministic, credential-free transport for V2 client tests. */
export class FixtureImpactTransport implements ImpactTransport {
  readonly requests: ImpactTransportRequest[] = [];
  readonly waits: number[] = [];
  private cursor = 0;
  private readonly steps: FixtureTransportStep[];

  constructor(steps: FixtureTransportStep[]) {
    this.steps = steps;
  }

  async execute(request: ImpactTransportRequest): Promise<ImpactTransportResult> {
    this.requests.push(request);
    const step = this.steps[this.cursor++];
    if (!step) throw new Error(`unexpected request ${request.url}`);
    if (step.expectedUrl !== undefined && step.expectedUrl !== request.url) {
      throw new Error(`expected ${step.expectedUrl}, received ${request.url}`);
    }
    if (
      step.expectedCredentialDisposition !== undefined &&
      step.expectedCredentialDisposition !== request.credentialDisposition
    ) {
      throw new Error(
        `expected ${step.expectedCredentialDisposition}, received ${request.credentialDisposition}`,
      );
    }
    return step.result;
  }

  async wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("aborted");
    this.waits.push(delayMs);
  }
}
