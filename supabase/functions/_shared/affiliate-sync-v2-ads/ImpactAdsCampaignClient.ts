import type { ImpactContinuationPolicy } from "../affiliate-sync-v2/impact-url-safety.ts";
import type { RawImpactCampaignForAdsV2 } from "./ad-models.ts";
import type {
  ImpactAdsFetchDiagnosticsV2,
  ImpactAdsFetchLimitsV2,
  ImpactAdsTransportV2,
} from "./ads-diagnostics.ts";
import { ImpactAdsCampaignPageParser } from "./ImpactAdsCampaignPageParser.ts";
import {
  fetchBoundedImpactCollectionV2,
  isExactInitialCampaignsRequestV2,
} from "./impact-bounded-client.ts";

export interface ImpactCampaignFetchResultForAdsV2 {
  records: RawImpactCampaignForAdsV2[];
  diagnostics: ImpactAdsFetchDiagnosticsV2;
}

export interface ImpactAdsCampaignClientOptionsV2 {
  transport: ImpactAdsTransportV2;
  continuationPolicy: ImpactContinuationPolicy;
  requestTimeoutMs: number;
  limits: ImpactAdsFetchLimitsV2;
}

/** Dedicated Campaign retrieval with no Promotions runtime dependency. */
export class ImpactAdsCampaignClient {
  private readonly options: ImpactAdsCampaignClientOptionsV2;

  constructor(options: ImpactAdsCampaignClientOptionsV2) {
    this.options = options;
  }

  fetch(
    initialUrl: string,
    signal?: AbortSignal,
  ): Promise<ImpactCampaignFetchResultForAdsV2> {
    return fetchBoundedImpactCollectionV2(
      initialUrl,
      {
        stream: "campaigns",
        transport: this.options.transport,
        continuationPolicy: this.options.continuationPolicy,
        limits: this.options.limits,
        requestTimeoutMs: this.options.requestTimeoutMs,
        parse: ImpactAdsCampaignPageParser.parse,
        exactInitialRequest: isExactInitialCampaignsRequestV2,
      },
      signal,
    );
  }
}
