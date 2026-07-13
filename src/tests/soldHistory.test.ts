import { describe, expect, it } from "vitest";
import { extractMediaSleeveGrades, inferArtistAndRelease, inferSoldCondition, soldHistoryKey } from "../lib/soldHistory/normalize";

describe("sold history normalization", () => {
  it("classifies sealed title conventions", () => {
    expect(inferSoldCondition("Moby Grape- Live Grape New/Sealed 1978")).toBe("new_sealed");
    expect(inferSoldCondition("Noah Kahan - Live From Fenway Brand New Vinyl")).toBe("new_sealed");
    expect(inferSoldCondition("The Who - Who's Next Limited edition Blue Transparent", "Whole W 17.00")).toBe("new_sealed");
  });

  it("classifies and extracts used grading", () => {
    expect(inferSoldCondition("Blondie - Plastic Letters VG+/VG+ 1978 Santa Maria Pressing")).toBe("used");
    expect(extractMediaSleeveGrades("Blondie - Plastic Letters VG+/VG+ 1978")).toEqual({
      mediaGrade: "VG+",
      sleeveGrade: "VG+",
    });
  });

  it("builds a reusable artist and release key", () => {
    expect(inferArtistAndRelease("Bryson Tiller - Trapsoul | Brand New/Sealed Vinyl")).toEqual({
      artist: "Bryson Tiller",
      releaseTitle: "Trapsoul Vinyl",
    });
    expect(soldHistoryKey("Bryson Tiller - Trapsoul | Brand New/Sealed Vinyl")).toBe("bryson tiller::trapsoul");
  });
});
