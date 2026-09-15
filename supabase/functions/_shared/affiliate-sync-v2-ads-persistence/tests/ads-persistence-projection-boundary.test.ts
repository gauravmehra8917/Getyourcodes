import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAdsOfferCreateProjectionV2,
  projectAdsStoreCreateProjectionV2,
} from "../AdsPersistencePlannerV2.ts";

test(
  "detached refresh planning can reuse the exact Ads planner projection functions",
  () => {
    assert.equal(
      typeof projectAdsStoreCreateProjectionV2,
      "function",
    );

    assert.equal(
      typeof projectAdsOfferCreateProjectionV2,
      "function",
    );
  },
);
