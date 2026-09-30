import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RetailDiscoveryStatus } from "../components/RetailDiscoveryStatus";
it("does not imply market coverage or completed search when missing", () => {
  const html = renderToStaticMarkup(<RetailDiscoveryStatus payload={null} />);
  expect(html).toContain("configured retailers, not the whole market");
  expect(html).toContain("not captured for this publication");
});
it("reports exact homepage coverage separately from unverified new domains", () => {
  const html = renderToStaticMarkup(<RetailDiscoveryStatus payload={{createdAt:"2026-09-30",finds:[],sourceReports:[{id:"vinyl-price-drop",adapterStats:{homepageCardCount:50,homepageCheckedCount:49,homepageFailedCount:1}}], discoveryAudit:{status:"observed",searches:[],leads:[],newRetailerLeads:[{url:"https://shop.example/sale",title:"New shop sale",status:"new_retailer_review_required",capturedAt:"2026-09-30"}]}}}/>);
  expect(html).toContain("49/50 cards checked; 1 inaccessible");
  expect(html).toContain('href="https://shop.example/sale"');
});
