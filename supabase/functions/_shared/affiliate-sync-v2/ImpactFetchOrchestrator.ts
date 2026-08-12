import {
  ImpactClientV2,
  type ImpactClientV2Options,
} from "./ImpactClientV2.ts";
import type {
  ImpactStreamFetchDiagnosticsV2,
  QuarantinedImpactRecordV2,
} from "./diagnostics.ts";
import type { RawImpactCampaignV2, RawImpactPromotionV2 } from "./models.ts";

export interface ImpactProviderFetchInputV2 extends ImpactClientV2Options {
  promotionsInitialUrl: string;
  campaignsInitialUrl: string;
  signal?: AbortSignal;
}

export interface ImpactProviderFetchResultV2 {
  acceptedPromotions: RawImpactPromotionV2[];
  acceptedCampaigns: RawImpactCampaignV2[];
  fetchDiagnostics: {
    promotions: ImpactStreamFetchDiagnosticsV2;
    campaigns: ImpactStreamFetchDiagnosticsV2;
  };
  quarantinedRecords: QuarantinedImpactRecordV2[];
}

/**
 * Transport-owning boundary for provider retrieval only. Parsing remains in
 * ImpactClientV2; deduplication and all business planning remain outside.
 */
export class ImpactFetchOrchestrator {
  static async retrieve(input: ImpactProviderFetchInputV2): Promise<ImpactProviderFetchResultV2> {
    const client = new ImpactClientV2({
      transport: input.transport,
      continuationPolicy: input.continuationPolicy,
      limits: input.limits,
      requestTimeoutMs: input.requestTimeoutMs,
      ...(input.jitter === undefined ? {} : { jitter: input.jitter }),
    });
    const promotions = await client.fetchPromotions(input.promotionsInitialUrl, input.signal);
    const campaigns = await client.fetchCampaigns(input.campaignsInitialUrl, input.signal);

    return {
      acceptedPromotions: promotions.records,
      acceptedCampaigns: campaigns.records,
      fetchDiagnostics: {
        promotions: promotions.diagnostics,
        campaigns: campaigns.diagnostics,
      },
      quarantinedRecords: [
        ...promotions.quarantinedRecords,
        ...campaigns.quarantinedRecords,
      ],
    };
  }
}
