import type { ImpactContinuationPolicy } from "../affiliate-sync-v2/impact-url-safety.ts";
import type { RawImpactAdV2 } from "./ad-models.ts";
import {
  DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2,
  type ImpactAdsFetchDiagnosticsV2,
  type ImpactAdsFetchLimitsV2,
  type ImpactAdsTransportV2,
} from "./ads-diagnostics.ts";
import { ImpactAdsPageParser } from "./ImpactAdsPageParser.ts";
import {
  fetchBoundedImpactCollectionV2,
  isExactInitialAdsRequestV2,
} from "./impact-bounded-client.ts";

export interface ImpactAdsFetchResultV2 {
  records: RawImpactAdV2[];
  diagnostics: ImpactAdsFetchDiagnosticsV2;
}

export interface ImpactAdsClientOptionsV2 {
  transport: ImpactAdsTransportV2;
  continuationPolicy: ImpactContinuationPolicy;
  requestTimeoutMs: number;
  limits?: ImpactAdsFetchLimitsV2;
}

/** Complete, bounded retrieval of global Impact Coupon Ads. */
export class ImpactAdsClient {
  private readonly options: ImpactAdsClientOptionsV2;

  constructor(options: ImpactAdsClientOptionsV2) {
    this.options = options;
  }

  fetch(
    initialUrl: string,
    signal?: AbortSignal,
  ): Promise<ImpactAdsFetchResultV2> {
    return fetchBoundedImpactCollectionV2(
      initialUrl,
      {
        stream: "ads",
        transport: this.options.transport,
        continuationPolicy: this.options.continuationPolicy,
        limits: this.options.limits ?? {
          ...DEFAULT_IMPACT_ADS_FETCH_LIMITS_V2,
        },
        requestTimeoutMs: this.options.requestTimeoutMs,
        parse: ImpactAdsPageParser.parse,
        exactInitialRequest: isExactInitialAdsRequestV2,
      },
      signal,
    );
  }
}
