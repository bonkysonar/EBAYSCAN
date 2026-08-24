import { describe, expect, it } from "vitest";
import { classifyVinylLot } from "../lib/vinylLots/classifyLot";

describe("vinyl lot discovery classification", () => {
  it("qualifies a supported 12-record hip-hop lot without making a value claim", () => {
    const result = classifyVinylLot({
      title: "Lot of 12 Rap Hip-Hop LPs - Nas, Outkast, A Tribe Called Quest - VG+",
      searchGenre: "hip-hop",
    });

    expect(result.status).toBe("qualifying");
    expect(result.quantity.count).toBe(12);
    expect(result.genre.matchesTarget).toBe(true);
    expect(result.condition.level).toBe("supported-vg-plus");
    expect(JSON.stringify(result)).not.toMatch(/profit|roi|undervalued|offer/i);
  });

  it("qualifies a 14-record jazz lot at the default threshold", () => {
    const result = classifyVinylLot({
      title: "Lot of 14 Jazz LP Records Miles Davis John Coltrane Art Blakey",
      searchGenre: "instrumental-jazz",
    });

    expect(result.status).toBe("qualifying");
    expect(result.flags).toContain("condition-unverified");
  });

  it("uses 12 as the hard review floor when a higher custom target is selected", () => {
    const result = classifyVinylLot({
      minimumRecords: 20,
      title: "Lot of 14 Jazz LP Records Miles Davis John Coltrane Art Blakey",
      searchGenre: "instrumental-jazz",
    });

    expect(result.status).toBe("near-match");
    expect(result.flags).toContain("near-match-size");
  });

  it("rejects you-pick and per-record variation listings", () => {
    expect(classifyVinylLot({
      title: "Classic Rock Vinyl Records You Pick - $4.99 each",
      searchGenre: "classic-rock",
    }).status).toBe("rejected");
  });

  it("rejects the documented low-grade pattern even when count and artists are attractive", () => {
    const result = classifyVinylLot({
      title: "Lot of 23 Classic Rock LPs Pink Floyd Led Zeppelin G+/G condition",
      searchGenre: "classic-rock",
    });

    expect(result.status).toBe("review");
    expect(result.condition.level).toBe("below-target");
    expect(result.flags).toContain("condition-below-target");
  });

  it("does not let the search query supply unsupported genre evidence", () => {
    const result = classifyVinylLot({
      title: "Lot of 25 Assorted Vinyl Records Mixed Collection",
      searchGenre: "1990s-rock",
    });

    expect(result.status).toBe("review");
    expect(result.genre.matchesTarget).toBe(false);
  });

  it("rejects small 45 RPM lots", () => {
    const result = classifyVinylLot({
      title: "Big Chief 7-inch Vinyl Lot (5) Early 90s Alternative",
      searchGenre: "1990s-rock",
    });

    expect(result.status).toBe("rejected");
    expect(result.flags).toContain("singles-or-45-rpm");
  });

  it("rejects explicitly labeled 12-inch singles and empty sleeve lots", () => {
    expect(classifyVinylLot({
      title: "Rap Hip Hop Collection 12 12\" Singles Twista DJ Quik + More",
      searchGenre: "hip-hop",
    }).status).toBe("rejected");

    const sleeves = classifyVinylLot({
      title: "Vinyl Record Album Covers Lot of 15 Empty LP Sleeves Rock Rap",
      searchGenre: "hip-hop",
    });
    expect(sleeves.status).toBe("rejected");
    expect(sleeves.flags).toContain("packaging-only");
  });

  it("keeps a genuine unknown-count collection for review but rejects an apparent single LP", () => {
    expect(classifyVinylLot({
      title: "Miles Davis John Coltrane Jazz Vinyl Collection",
      searchGenre: "instrumental-jazz",
    }).status).toBe("review");

    const single = classifyVinylLot({
      priorityArtists: [{ genre: "instrumental-jazz", mode: "always-review", name: "Miles Davis" }],
      title: "Miles Davis Kind of Blue LP Columbia Used",
      searchGenre: "instrumental-jazz",
    });
    expect(single.status).toBe("rejected");
    expect(single.flags).toContain("single-item-likely");
  });

  it("recognizes compact count forms and removes undersized search noise", () => {
    expect(classifyVinylLot({
      title: "4x LPs Jazz Brass Lot - Gene Ammons and Oliver Nelson",
      searchGenre: "instrumental-jazz",
    }).status).toBe("rejected");

    expect(classifyVinylLot({
      title: "70s Classic Rock Lot 20 Iron Butterfly Kinks Rush VG+",
      searchGenre: "classic-rock",
    }).quantity.count).toBe(20);
  });

  it("does not mistake a 12-inch format or Rap-A-Lot label text for a 12-record count", () => {
    const single = classifyVinylLot({
      title: "Ganksta Nip Rap-A-Lot 12\" Promo Vinyl Record 1998",
      searchGenre: "hip-hop",
    });

    expect(single.quantity.count).toBeNull();
    expect(single.status).toBe("rejected");
  });

  it("extracts leading counts that have genre words before the record format", () => {
    expect(classifyVinylLot({
      title: "48 Hip Hop Vinyl Records Lot Collection",
      searchGenre: "hip-hop",
    }).quantity.count).toBe(48);

    expect(classifyVinylLot({
      title: "4 Iconic 80s Rock Vinyl Bundle LP Lot",
      searchGenre: "classic-rock",
    }).status).toBe("rejected");
  });

  it("does not treat catalog numbers beside one LP as collection quantities", () => {
    const result = classifyVinylLot({
      title: "Art Tatum Piano Starts Here Columbia CS 9655 Vintage Jazz Vinyl LP VG+",
      searchGenre: "instrumental-jazz",
    });

    expect(result.quantity.count).toBeNull();
    expect(result.status).toBe("rejected");
  });
});
