export const safeCampaigns = [
  { CampaignId: "campaign-1", Category: "Fashion" },
  { CampaignId: "campaign-2", Categories: ["Fashion", "Clothing"] },
  { CampaignId: "campaign-3", Vertical: "Home & Garden" },
  { CampaignId: "campaign-4", Verticals: ["Travel", "Hotels"] },
  { CampaignId: 123, Categories: " Electronics ", Vertical: "electronics" },
  { CampaignId: "campaign-6", Category: null, Categories: [], Verticals: "" },
] as const;

export const malformedCampaigns = [
  null,
  "Fashion",
  { AdvertiserId: "campaign-1", Category: "Fashion" },
  { CampaignId: "campaign-1", Categories: { Name: "Fashion" } },
  { CampaignId: "campaign-1", Categories: ["Fashion", 12] },
  { CampaignId: "campaign-1", Category: true },
  { CampaignId: "campaign-1", Category: "Fashion\u0000" },
  { CampaignId: "campaign-1", Category: "x".repeat(161) },
  { CampaignId: "campaign-1", Categories: Array(33).fill("Fashion") },
  { CampaignId: NaN, Category: "Fashion" },
] as const;
