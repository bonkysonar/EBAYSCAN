export type RetailArbitrageSourceType =
  | "audiophile_retailer"
  | "distributor_discovery"
  | "distributor_network"
  | "indie_label_store"
  | "international_retailer"
  | "label_direct"
  | "major_label_store"
  | "marketplace_retailer"
  | "metal_punk_label"
  | "soundtrack_label"
  | "uk_retailer"
  | "us_retailer";

export type VinylShopSourceType =
  | "deal-aggregator"
  | "marketplace"
  | "retailer"
  | "shopify-store"
  | "social-feed";

export type SourcePriority = 1 | 2 | 3 | 4;
export type SourceNoiseLevel = "high" | "low" | "medium";
export type SaleLikelihood = "high" | "low" | "medium";

export type SourceGroup =
  | "Audiophile retailers"
  | "Discovery sources"
  | "Distributor networks"
  | "Indie labels"
  | "Major label stores"
  | "Metal / punk / hardcore"
  | "Soundtrack / video-game labels"
  | "UK / international retailers"
  | "US retailers";

export type RetailArbitrageSource = {
  baseUrl: string;
  country: string;
  crawlType: VinylShopSourceType;
  defaultDiscountThreshold: number;
  displayName: string;
  domain: string;
  group: SourceGroup;
  id: string;
  isDiscoveryOnly?: boolean;
  minNetProfit: number;
  minROI: number;
  noiseLevel: SourceNoiseLevel;
  notes: string;
  priority: SourcePriority;
  saleLikelihood: SaleLikelihood;
  salePathHints?: string[];
  saleUrlPatterns?: string[];
  sourceType: RetailArbitrageSourceType;
};

export type VinylShopSource = {
  id: string;
  name: string;
  sourceType: VinylShopSourceType;
  url: string;
};

const commonSalePathHints = [
  "/sale",
  "/sales",
  "/clearance",
  "/outlet",
  "/deals",
  "/discounted",
  "/last-chance",
  "/warehouse-sale",
  "/black-friday",
  "/cyber-monday",
  "/summer-sale",
  "/holiday-sale",
  "/rsd-sale",
  "/record-store-day",
  "/collections/sale",
  "/collections/clearance",
  "/collections/outlet",
  "/collections/last-chance",
  "/collections/warehouse-sale",
  "/collections/50-off",
  "/collections/vinyl-sale",
  "/collections/record-sale",
];

const strictPublicSourceRules = {
  defaultDiscountThreshold: 0.4,
  minNetProfit: 12,
  minROI: 0.45,
  noiseLevel: "high" as const,
};

const strictMarketplaceRules = {
  defaultDiscountThreshold: 0.4,
  minNetProfit: 12,
  minROI: 0.5,
  noiseLevel: "high" as const,
};

const normalSourceRules = {
  defaultDiscountThreshold: 0.3,
  minNetProfit: 10,
  minROI: 0.35,
  noiseLevel: "medium" as const,
};

const labelSourceRules = {
  defaultDiscountThreshold: 0.3,
  minNetProfit: 8,
  minROI: 0.3,
  noiseLevel: "medium" as const,
};

function source(source: RetailArbitrageSource): RetailArbitrageSource {
  return source;
}

export const retailArbitrageSourceCatalog: RetailArbitrageSource[] = [
  source({
    id: "deep-discount",
    displayName: "DeepDiscount",
    domain: "deepdiscount.com",
    baseUrl: "https://www.deepdiscount.com/music/vinyl",
    country: "US",
    sourceType: "distributor_network",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "Distributor networks",
    notes: "Alliance/AENT ecosystem; strong sale volume but many false positives.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "popmarket",
    displayName: "PopMarket",
    domain: "popmarket.com",
    baseUrl: "https://www.popmarket.com/deals",
    country: "US",
    sourceType: "distributor_network",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "Distributor networks",
    notes: "Alliance/AENT ecosystem; noisy public deal source.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "importcds",
    displayName: "ImportCDs",
    domain: "importcds.com",
    baseUrl: "https://www.importcds.com/music/vinyl",
    country: "US",
    sourceType: "distributor_network",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "Distributor networks",
    notes: "Alliance/AENT ecosystem; require stronger margin and match confidence.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "collectors-choice-music",
    displayName: "Collectors' Choice Music",
    domain: "ccmusic.com",
    baseUrl: "https://www.ccmusic.com/music/vinyl",
    country: "US",
    sourceType: "distributor_network",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "Distributor networks",
    notes: "Alliance/AENT ecosystem; noisy public inventory.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "wowhd",
    displayName: "WowHD",
    domain: "wowhd.us",
    baseUrl: "https://www.wowhd.us/music/vinyl",
    country: "US",
    sourceType: "distributor_network",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "medium",
    ...strictPublicSourceRules,
    group: "Distributor networks",
    notes: "Alliance/AENT ecosystem; discovery and sale checks only until product matching is strong.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "movies-unlimited",
    displayName: "Movies Unlimited",
    domain: "moviesunlimited.com",
    baseUrl: "https://www.moviesunlimited.com/music/vinyl",
    country: "US",
    sourceType: "distributor_network",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "medium",
    ...strictPublicSourceRules,
    group: "Distributor networks",
    notes: "Alliance/AENT ecosystem; likely noisy and should require strict margin.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "udiscover-music",
    displayName: "uDiscover Music",
    domain: "shop.udiscovermusic.com",
    baseUrl: "https://shop.udiscovermusic.com/collections/vinyl",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "Major label stores",
    notes: "UMG direct store; large sales but noisy catalog and inflated compare-at prices.",
    salePathHints: ["/collections/50-off-select-vinyl", "/collections/vinyl", ...commonSalePathHints],
  }),
  source({
    id: "sound-of-vinyl",
    displayName: "The Sound of Vinyl",
    domain: "thesoundofvinyl.us",
    baseUrl: "https://thesoundofvinyl.us/collections/deep-cuts-q2",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "Major label stores",
    notes: "UMG direct store; Deep Cuts is the current high-signal sale path.",
    salePathHints: ["/collections/deep-cuts-q2", "/collections/sale", "/collections/50-off-select-vinyl", ...commonSalePathHints],
  }),
  source({
    id: "blue-note-store",
    displayName: "Blue Note Store",
    domain: "store.bluenote.com",
    baseUrl: "https://store.bluenote.com/collections/vinyl",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "Boost Blue Note Tone Poet, audiophile and limited editions.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "verve-store",
    displayName: "Verve Store",
    domain: "store.vervemusic.com",
    baseUrl: "https://store.vervemusic.com/collections/vinyl",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "Boost Acoustic Sounds Series, jazz and audiophile reissues.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "capitol-records-store",
    displayName: "Capitol Records Store",
    domain: "shop.capitolrecords.com",
    baseUrl: "https://shop.capitolrecords.com/collections/vinyl",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "Major-label direct store; preserve variant identity for exclusives.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "republic-records-store",
    displayName: "Republic Records Store",
    domain: "shop.republicrecords.com",
    baseUrl: "https://shop.republicrecords.com/collections/vinyl",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "Major-label direct store; noisy pop catalog, boost exclusives.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "def-jam",
    displayName: "Def Jam Store",
    domain: "shop.defjam.com",
    baseUrl: "https://shop.defjam.com/collections/all-vinyl",
    country: "US",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "Major-label direct store; catalog and hip-hop reissues.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "abbey-road-store",
    displayName: "Abbey Road Store",
    domain: "shop.abbeyroad.com",
    baseUrl: "https://shop.abbeyroad.com/collections/vinyl",
    country: "UK",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "UK landed cost needs FX, VAT handling, international shipping, duty and damage reserve.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "emi-store",
    displayName: "EMI Store",
    domain: "shop.emirecords.com",
    baseUrl: "https://shop.emirecords.com/collections/vinyl",
    country: "UK",
    sourceType: "major_label_store",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "Major label stores",
    notes: "UK landed cost needs FX, VAT handling, international shipping, duty and damage reserve.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "recordstore-uk",
    displayName: "Recordstore UK",
    domain: "recordstore.co.uk",
    baseUrl: "https://recordstore.co.uk/collections/vinyl",
    country: "UK",
    sourceType: "uk_retailer",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "high",
    ...normalSourceRules,
    group: "UK / international retailers",
    notes: "UK retailer; landed cost must include FX, shipping, VAT/duty risk and damage reserve.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "townsend-music",
    displayName: "Townsend Music",
    domain: "townsendmusic.store",
    baseUrl: "https://townsendmusic.store/collections/vinyl",
    country: "UK",
    sourceType: "uk_retailer",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "high",
    ...normalSourceRules,
    group: "UK / international retailers",
    notes: "UK retailer; include FX, shipping, VAT/duty and damage risk.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "rarewaves",
    displayName: "Rarewaves",
    domain: "rarewaves.com",
    baseUrl: "https://www.rarewaves.com/collections/vinyl",
    country: "UK",
    sourceType: "uk_retailer",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "UK / international retailers",
    notes: "Noisy public UK source; require stricter threshold plus landed-cost reserve.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "hmv",
    displayName: "HMV",
    domain: "hmv.com",
    baseUrl: "https://hmv.com/store/music/vinyl",
    country: "UK",
    sourceType: "uk_retailer",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "high",
    ...strictPublicSourceRules,
    group: "UK / international retailers",
    notes: "Noisy public UK source; require stricter threshold and landed-cost reserve.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "rough-trade",
    displayName: "Rough Trade",
    domain: "roughtrade.com",
    baseUrl: "https://www.roughtrade.com/en-us/collection/sale",
    country: "UK/US",
    sourceType: "uk_retailer",
    crawlType: "retailer",
    priority: 1,
    saleLikelihood: "medium",
    ...normalSourceRules,
    group: "UK / international retailers",
    notes: "Useful for imports, exclusives and sale sections; account for market region.",
    salePathHints: commonSalePathHints,
  }),
  ...[
    ["norman-records", "Norman Records", "normanrecords.com", "https://www.normanrecords.com/sale/vinyl"],
    ["resident-music", "Resident Music", "resident-music.com", "https://www.resident-music.com/department.aspx?dept=vinyl"],
    ["banquet-records", "Banquet Records", "banquetrecords.com", "https://www.banquetrecords.com/vinyl"],
    ["juno", "Juno", "juno.co.uk", "https://www.juno.co.uk/all/back-cat/vinyl/"],
    ["bleep", "Bleep", "bleep.com", "https://bleep.com/format/vinyl"],
    ["plastic-head-megastore", "Plastic Head Megastore", "plasticheadmegastore.com", "https://plasticheadmegastore.com/collections/vinyl"],
    ["zavvi", "Zavvi", "zavvi.com", "https://www.zavvi.com/merch-vinyl.list"],
    ["assai-records", "Assai Records", "assai.co.uk", "https://assai.co.uk/collections/vinyl"],
    ["crash-records", "Crash Records", "crashrecords.co.uk", "https://www.crashrecords.co.uk/collections/vinyl"],
    ["sister-ray", "Sister Ray", "sisterray.co.uk", "https://sisterray.co.uk/collections/vinyl"],
    ["vinilo", "Vinilo", "vinilo.co.uk", "https://vinilo.co.uk/collections/vinyl"],
    ["piccadilly-records", "Piccadilly Records", "piccadillyrecords.com", "https://www.piccadillyrecords.com/counter/catalogue.php?genre=0"],
    ["sounds-of-the-universe", "Sounds of the Universe", "soundsoftheuniverse.com", "https://soundsoftheuniverse.com/browse/c-vinyl"],
    ["honest-jons", "Honest Jon's", "honestjons.com", "https://honestjons.com/shop/category/Vinyl"],
    ["drift-records", "Drift Records", "driftrecords.com", "https://driftrecords.com/collections/vinyl"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: "UK",
      sourceType: "uk_retailer",
      crawlType: domain.includes("myshopify") || baseUrl.includes("/collections/") ? "shopify-store" : "retailer",
      priority: displayName === "Zavvi" ? 3 : 1,
      saleLikelihood: "medium",
      ...(displayName === "Zavvi" ? strictPublicSourceRules : normalSourceRules),
      group: "UK / international retailers",
      notes:
        displayName === "Bleep"
          ? "UK source; boost Warp, electronic and exclusive variants while accounting for landed cost."
          : "UK source; landed cost needs FX, international shipping, VAT/duty risk and damage reserve.",
      salePathHints: commonSalePathHints,
    }),
  ),
  source({
    id: "plaid-room-records",
    displayName: "Plaid Room Records",
    domain: "plaidroomrecords.com",
    baseUrl: "https://www.plaidroomrecords.com/collections/sale-vinyl",
    country: "US",
    sourceType: "us_retailer",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "high",
    ...normalSourceRules,
    group: "US retailers",
    notes: "Known for deep sale/warehouse markdowns.",
    salePathHints: commonSalePathHints,
  }),
  source({
    id: "lunchbox-records",
    displayName: "Lunchbox Records",
    domain: "lunchboxrecords.com",
    baseUrl: "https://lunchboxrecords.com/collections/super-sale-lps",
    country: "US",
    sourceType: "us_retailer",
    crawlType: "shopify-store",
    priority: 1,
    saleLikelihood: "high",
    ...normalSourceRules,
    group: "US retailers",
    notes: "Known super-sale LP section; preserve variants and stock status.",
    salePathHints: commonSalePathHints,
  }),
  ...[
    ["bull-moose", "Bull Moose", "bullmoose.com", "https://www.bullmoose.com/c/695/vinyl-clearance"],
    ["zia-records", "Zia Records", "ziarecords.com", "https://www.ziarecords.com/c/44/featured-vinyl"],
    ["newbury-comics", "Newbury Comics", "newburycomics.com", "https://www.newburycomics.com/collections/special-price-vinyl"],
    ["amoeba", "Amoeba", "amoeba.com", "https://www.amoeba.com/music/vinyl/"],
    ["turntable-lab", "Turntable Lab", "turntablelab.com", "https://www.turntablelab.com/collections/clearance-sale-alpha"],
    ["light-in-the-attic", "Light in the Attic", "lightintheattic.net", "https://lightintheattic.net/collections/vinyl"],
    ["mondo", "Mondo", "mondoshop.com", "https://mondoshop.com/collections/vinyl"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: "US",
      sourceType: displayName === "Mondo" ? "soundtrack_label" : displayName === "Light in the Attic" ? "label_direct" : "us_retailer",
      crawlType: baseUrl.includes("/collections/") ? "shopify-store" : "retailer",
      priority: displayName === "Turntable Lab" ? 2 : 1,
      saleLikelihood: "medium",
      ...normalSourceRules,
      group: displayName === "Mondo" ? "Soundtrack / video-game labels" : "US retailers",
      notes:
        displayName === "Turntable Lab"
          ? "Lower priority unless actual markdowns or exclusive variants are detected."
          : displayName === "Mondo"
            ? "Soundtrack variants, exclusives and limited editions."
            : "US retailer; boost sale markdowns, exclusives and limited variants.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["music-direct", "Music Direct", "musicdirect.com", "https://www.musicdirect.com/music/vinyl/"],
    ["acoustic-sounds", "Acoustic Sounds", "acousticsounds.com", "https://store.acousticsounds.com/c/15/Vinyl_Records"],
    ["elusive-disc", "Elusive Disc", "elusivedisc.com", "https://elusivedisc.com/music/vinyl/"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: "US",
      sourceType: "audiophile_retailer",
      crawlType: "retailer",
      priority: 2,
      saleLikelihood: "medium",
      ...normalSourceRules,
      group: "Audiophile retailers",
      notes: "Boost audiophile reissues, box sets, MoFi/Analogue Productions/UHQR and closeouts.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["walmart", "Walmart", "walmart.com", "https://www.walmart.com/search?q=vinyl+records&catId=4104_1205481&max_price=20"],
    ["target", "Target", "target.com", "https://www.target.com/c/vinyl-records-music-movies-books/-/N-yz7ntZakkos?moveTo=product-list-grid"],
    ["barnes-noble", "Barnes & Noble", "barnesandnoble.com", "https://www.barnesandnoble.com/b/vinyl-special-offer/_/N-308r?Nrpp=40&page=1"],
    ["urban-outfitters", "Urban Outfitters", "urbanoutfitters.com", "https://www.urbanoutfitters.com/sale?department=Music&attributionProductType=Music"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: "US",
      sourceType: "marketplace_retailer",
      crawlType: "retailer",
      priority: 3,
      saleLikelihood: "medium",
      ...strictMarketplaceRules,
      group: "US retailers",
      notes: displayName === "Urban Outfitters" ? "Noisy public source; boost exclusive variants only." : "Noisy public source; require strict margin and match confidence.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["craft-recordings", "Craft Recordings", "craftrecordings.com", "https://craftrecordings.com/collections/volume-sale"],
    ["rhino", "Rhino", "rhino.com", "https://store.rhino.com/en/rhino-store/music/vinyl/"],
    ["sony-legacy", "Sony Legacy", "legacyrecordings.com", "https://www.legacyrecordings.com/"],
    ["we-are-vinyl", "We Are Vinyl", "wearevinyl.com", "https://www.wearevinyl.com/"],
    ["numero-group", "Numero Group", "numerogroup.com", "https://numerogroup.com/collections/vinyl"],
    ["sundazed", "Sundazed", "sundazed.com", "https://sundazed.com/collections/vinyl"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: "US",
      sourceType: displayName.includes("Sony") || displayName.includes("Vinyl") ? "major_label_store" : "label_direct",
      crawlType: baseUrl.includes("/collections/") ? "shopify-store" : "retailer",
      priority: 2,
      saleLikelihood: "medium",
      ...labelSourceRules,
      group: displayName.includes("Sony") || displayName.includes("Vinyl") ? "Major label stores" : "Indie labels",
      notes: "Boost catalog/reissue, limited variants, box sets and audiophile reissues.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["secretly-store", "Secretly Store", "secretlystore.com", "https://www.secretlystore.com/store/vinyl"],
    ["sub-pop", "Sub Pop", "subpop.com", "https://megamart.subpop.com/collections/vinyl"],
    ["merge-records", "Merge Records", "mergerecords.com", "https://www.mergerecords.com/store/vinyl"],
    ["polyvinyl-records", "Polyvinyl Records", "polyvinylrecords.com", "https://www.polyvinylrecords.com/store/vinyl"],
    ["domino-us", "Domino US", "dominorecordco.us", "https://www.dominorecordco.us/collections/vinyl"],
    ["domino-mart", "Domino Mart", "dominomart.com", "https://www.dominomart.com/collections/vinyl"],
    ["matador-records", "Matador Records", "matadorrecords.com", "https://store.matadorrecords.com/format/vinyl"],
    ["beggars", "Beggars", "beggars.com", "https://shop.beggars.com/collections/vinyl"],
    ["4ad", "4AD", "4ad.com", "https://shop.4ad.com/collections/vinyl"],
    ["xl-recordings", "XL Recordings", "xlrecordings.com", "https://shop.xlrecordings.com/collections/vinyl"],
    ["young-recordings", "Young Recordings", "youngrecordings.com", "https://youngrecordings.com/collections/vinyl"],
    ["rough-trade-records", "Rough Trade Records", "roughtraderecords.com", "https://shop.roughtraderecords.com/collections/vinyl"],
    ["ninja-tune", "Ninja Tune", "ninjatune.net", "https://ninjatune.net/collections/vinyl"],
    ["stones-throw", "Stones Throw", "stonesthrow.com", "https://www.stonesthrow.com/store/vinyl/"],
    ["daptone-records", "Daptone Records", "daptonerecords.com", "https://shopdaptonerecords.com/collections/vinyl"],
    ["colemine-records", "Colemine Records", "coleminerecords.com", "https://www.coleminerecords.com/collections/vinyl"],
    ["new-west-records", "New West Records", "newwestrecords.com", "https://newwestrecords.com/collections/vinyl"],
    ["yep-roc", "Yep Roc", "yeproc.com", "https://www.yeproc.com/collections/vinyl"],
    ["fat-possum", "Fat Possum", "fatpossum.com", "https://fatpossum.com/collections/vinyl"],
    ["third-man-records", "Third Man Records", "thirdmanrecords.com", "https://thirdmanrecords.com/collections/vinyl"],
    ["captured-tracks", "Captured Tracks", "capturedtracks.com", "https://capturedtracks.com/collections/vinyl"],
    ["mexican-summer", "Mexican Summer", "mexicansummer.com", "https://mexicansummer.com/collections/vinyl"],
    ["sacred-bones", "Sacred Bones", "sacredbonesrecords.com", "https://www.sacredbonesrecords.com/collections/vinyl"],
    ["dais-records", "Dais Records", "daisrecords.com", "https://www.daisrecords.com/collections/vinyl"],
    ["saddle-creek", "Saddle Creek", "saddle-creek.com", "https://saddle-creek.com/collections/vinyl"],
    ["drag-city", "Drag City", "dragcity.com", "https://www.dragcity.com/products?format=vinyl"],
    ["thrill-jockey", "Thrill Jockey", "thrilljockey.com", "https://www.thrilljockey.com/store"],
    ["carpark-records", "Carpark Records", "carparkrecords.com", "https://www.carparkrecords.com/collections/vinyl"],
    ["partisan-records", "Partisan Records", "partisanrecords.com", "https://partisanrecords.com/collections/vinyl"],
    ["barsuk-records", "Barsuk Records", "barsuk.com", "https://www.barsuk.com/shop"],
    ["innovative-leisure", "Innovative Leisure", "innovativeleisure.net", "https://innovativeleisure.net/collections/vinyl"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: ["domino-mart", "ninja-tune", "partisan-records"].includes(id) ? "US/UK" : "US",
      sourceType: "indie_label_store",
      crawlType: baseUrl.includes("/collections/") || baseUrl.includes("shop.") ? "shopify-store" : "retailer",
      priority: 2,
      saleLikelihood: "medium",
      ...labelSourceRules,
      group: "Indie labels",
      notes: "Boost clearance, exclusives, colored variants, limited editions and low active supply.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["relapse-records", "Relapse Records", "relapse.com", "https://store.relapse.com/collections/vinyl"],
    ["nuclear-blast", "Nuclear Blast", "nuclearblast.com", "https://www.nuclearblast.com/collections/vinyl"],
    ["metal-blade", "Metal Blade", "metalblade.com", "https://www.metalblade.com/us/store/"],
    ["deathwish-inc", "Deathwish Inc.", "deathwishinc.com", "https://deathwishinc.com/collections/vinyl"],
    ["epitaph", "Epitaph", "epitaph.com", "https://epitaph.store/collections/vinyl"],
    ["anti", "ANTI-", "anti.com", "https://anti.com/store/"],
    ["kings-road-merch", "Kings Road Merch", "kingsroadmerch.com", "https://kingsroadmerch.com/collections/vinyl"],
    ["fat-wreck-chords", "Fat Wreck Chords", "fatwreck.com", "https://fatwreck.com/collections/vinyl"],
    ["pure-noise-records", "Pure Noise Records", "purenoise.net", "https://purenoise.merchnow.com/collections/vinyl"],
    ["run-for-cover-records", "Run For Cover Records", "runforcoverrecords.com", "https://www.runforcoverrecords.com/collections/vinyl"],
    ["topshelf-records", "Topshelf Records", "topshelfrecords.com", "https://www.topshelfrecords.com/products?format=vinyl"],
    ["hopeless-records", "Hopeless Records", "hopelessrecords.com", "https://hopelessrecords.com/collections/vinyl"],
    ["equal-vision", "Equal Vision", "equalvision.com", "https://equalvision.com/collections/vinyl"],
    ["sumerian-records", "Sumerian Records", "sumerianrecords.com", "https://sumerianrecords.com/collections/vinyl"],
    ["rise-records", "Rise Records", "riserecords.com", "https://riserecords.com/collections/vinyl"],
    ["century-media", "Century Media", "centurymedia.com", "https://centurymedia.store/collections/vinyl"],
    ["napalm-records-america", "Napalm Records America", "napalmrecordsamerica.com", "https://napalmrecordsamerica.com/collections/vinyl"],
    ["season-of-mist", "Season of Mist", "season-of-mist.com", "https://shopusa.season-of-mist.com/music/vinyl"],
    ["prosthetic-records", "Prosthetic Records", "prostheticrecords.com", "https://prostheticrecords.com/collections/vinyl"],
    ["southern-lord", "Southern Lord", "southernlord.com", "https://southernlord.com/store/"],
    ["closed-casket-activities", "Closed Casket Activities", "closedcasketactivities.com", "https://closedcasketactivities.com/collections/vinyl"],
    ["bridge-nine", "Bridge Nine", "bridge9.com", "https://www.bridge9.com/store/vinyl"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: ["nuclear-blast", "metal-blade", "century-media", "season-of-mist"].includes(id) ? "US/EU" : "US",
      sourceType: "metal_punk_label",
      crawlType: baseUrl.includes("/collections/") ? "shopify-store" : "retailer",
      priority: 2,
      saleLikelihood: "medium",
      ...labelSourceRules,
      group: "Metal / punk / hardcore",
      notes: "Small runs and variants matter; boost colored/splatter vinyl and collector demand.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["waxwork-records", "Waxwork Records", "waxworkrecords.com", "https://waxworkrecords.com/collections/vinyl"],
    ["iam8bit", "iam8bit", "iam8bit.com", "https://www.iam8bit.com/collections/vinyl"],
    ["laced-records", "Laced Records", "lacedrecords.com", "https://www.lacedrecords.com/collections/vinyl"],
    ["data-discs", "Data Discs", "data-discs.com", "https://data-discs.com/collections/records"],
    ["ship-to-shore-media", "Ship to Shore Media", "shiptoshoremedia.com", "https://shiptoshoremedia.com/collections/vinyl"],
    ["milan-records", "Milan Records", "milanrecords.com", "https://milanrecords.com/collections/vinyl"],
    ["varese-sarabande", "Varese Sarabande", "varesesarabande.com", "https://varesesarabande.com/collections/vinyl"],
    ["enjoy-the-ride-records", "Enjoy The Ride Records", "enjoytheriderecords.com", "https://enjoytheriderecords.com/collections/on-sale"],
    ["terror-vision", "Terror Vision", "terror-vision.com", "https://www.terror-vision.com/store/vinyl"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: ["laced-records", "data-discs"].includes(id) ? "UK" : "US",
      sourceType: "soundtrack_label",
      crawlType: baseUrl.includes("/collections/") ? "shopify-store" : "retailer",
      priority: 2,
      saleLikelihood: "medium",
      ...labelSourceRules,
      group: "Soundtrack / video-game labels",
      notes: "Boost soundtrack, horror/cult, video-game variants, exclusives and limited editions.",
      salePathHints: commonSalePathHints,
    }),
  ),
  ...[
    ["alliance-aent", "Alliance / AENT", "aent.com", "https://www.aent.com", "US", "Useful for discovering distributor-network labels and storefronts."],
    ["amped", "AMPED", "aent.com", "https://www.aent.com", "US", "Part of Alliance/AENT ecosystem."],
    ["redeye-worldwide", "Redeye Worldwide", "redeyeworldwide.com", "https://www.redeyeworldwide.com", "US", "Useful for discovering indie labels."],
    ["secretly-distribution", "Secretly Distribution", "secretlydistribution.com", "https://www.secretlydistribution.com", "US", "Distributor discovery only."],
    ["mvd-entertainment", "MVD Entertainment", "mvdentertainment.com", "https://mvdentertainment.com", "US", "Distributor discovery; MVD Shop is the retail crawl target."],
    ["mvd-shop", "MVD Shop", "mvdshop.com", "https://mvdshop.com/collections/warehouse-overstock-sale", "US", "Retail outlet for MVD warehouse overstock; kept as discovery/watchlist metadata here."],
    ["forced-exposure", "Forced Exposure", "forcedexposure.com", "https://www.forcedexposure.com", "US", "Distributor discovery only."],
    ["cobraside", "Cobraside", "cobraside.com", "https://www.cobraside.com", "US", "Distributor discovery only."],
    ["monostereo", "Monostereo", "monostereo.com", "https://monostereo.com", "US", "Distributor discovery only."],
    ["proper-music-group", "Proper Music Group", "propermusicgroup.com", "https://propermusicgroup.com", "UK", "Distributor discovery only."],
    ["proper-music", "Proper Music", "propermusic.com", "https://propermusic.com", "UK", "Distributor discovery only."],
    ["one-nation-vinyl", "One Nation Vinyl", "onenationvinyl.com", "https://onenationvinyl.com", "UK", "Distributor discovery only."],
    ["even-by-odd", "Even By Odd", "evenbyodd.co.uk", "https://evenbyodd.co.uk", "UK", "Distributor discovery only."],
    ["little-amber-fish", "Little Amber Fish", "littleamberfish.com", "https://littleamberfish.com", "UK", "Distributor discovery only."],
    ["cargo-records-uk", "Cargo Records UK", "cargorecords.co.uk", "https://cargorecords.co.uk", "UK", "Distributor discovery only."],
    ["cargo-records-germany", "Cargo Records Germany", "cargo-records.de", "https://www.cargo-records.de", "Germany", "Distributor discovery only."],
    ["republic-of-music", "Republic of Music", "republicofmusic.net", "https://republicofmusic.net", "UK", "Distributor discovery only."],
    ["pias-integral", "PIAS / Integral", "pias.com", "https://www.pias.com", "UK/EU", "Distributor discovery only."],
    ["kudos-distribution", "Kudos Distribution", "kudosdistribution.co.uk", "https://www.kudosdistribution.co.uk", "UK", "Distributor discovery only."],
    ["juno-distribution", "Juno Distribution", "juno.co.uk", "https://www.juno.co.uk", "UK", "Distributor discovery only; retail Juno source is active separately."],
    ["forte-distribution", "Forte Distribution", "fortedistribution.co.uk", "https://fortedistribution.co.uk", "UK", "Distributor discovery only."],
    ["plastic-head", "Plastic Head", "plastichead.com", "https://www.plastichead.com", "UK", "Distributor discovery only; megastore is active separately."],
    ["bertus", "Bertus", "bertus.com", "https://www.bertus.com", "Netherlands/EU", "Distributor discovery only."],
    ["srd", "SRD", "srd.co.uk", "https://www.srd.co.uk", "UK", "Distributor discovery only."],
    ["shellshock", "Shellshock", "shellshock.co.uk", "https://www.shellshock.co.uk", "UK", "Distributor discovery only."],
    ["trapeze", "Trapeze", "trapezemusic.com", "https://trapezemusic.com", "UK", "Distributor discovery only."],
    ["nova", "Nova", "novamusic.co.uk", "https://novamusic.co.uk", "UK", "Distributor discovery only."],
    ["the-orchard", "The Orchard", "theorchard.com", "https://www.theorchard.com", "US/Global", "Distributor discovery only."],
  ].map(([id, displayName, domain, baseUrl, country, notes]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country,
      sourceType: id === "mvd-shop" ? "us_retailer" : "distributor_discovery",
      crawlType: id === "mvd-shop" ? "shopify-store" : "retailer",
      priority: id === "mvd-shop" ? 2 : 4,
      saleLikelihood: id === "mvd-shop" ? "high" : "low",
      defaultDiscountThreshold: id === "mvd-shop" ? 0.3 : 0.5,
      minNetProfit: id === "mvd-shop" ? 8 : 12,
      minROI: id === "mvd-shop" ? 0.3 : 0.5,
      noiseLevel: id === "mvd-shop" ? "medium" : "high",
      group: id === "mvd-shop" ? "US retailers" : "Discovery sources",
      isDiscoveryOnly: id !== "mvd-shop",
      notes:
        id === "mvd-shop"
          ? "Active retail outlet for MVD warehouse overstock; prioritize real markdowns and record-level inventory."
          : notes,
      salePathHints: id === "mvd-shop" ? commonSalePathHints : [],
    }),
  ),
  source({
    id: "vinyl-price-drop",
    displayName: "Vinyl Price Drop",
    domain: "vinylpricedrop.com",
    baseUrl: "https://vinylpricedrop.com/",
    country: "US",
    sourceType: "international_retailer",
    crawlType: "deal-aggregator",
    priority: 4,
    saleLikelihood: "medium",
    defaultDiscountThreshold: 0.4,
    minNetProfit: 12,
    minROI: 0.45,
    noiseLevel: "high",
    group: "Discovery sources",
    notes: "Deal aggregator retained as discovery/watchlist source.",
    salePathHints: [],
  }),
  source({
    id: "cheap-vinyl",
    displayName: "Cheap Vinyl",
    domain: "cheapvinyl.wordpress.com",
    baseUrl: "https://cheapvinyl.wordpress.com/",
    country: "US",
    sourceType: "international_retailer",
    crawlType: "deal-aggregator",
    priority: 4,
    saleLikelihood: "medium",
    defaultDiscountThreshold: 0.4,
    minNetProfit: 12,
    minROI: 0.45,
    noiseLevel: "high",
    group: "Discovery sources",
    notes: "Deal aggregator retained as discovery/watchlist source.",
    salePathHints: [],
  }),
  source({
    id: "slickdeals-vinyl-records",
    displayName: "Slickdeals Vinyl Records",
    domain: "slickdeals.net",
    baseUrl:
      "https://slickdeals.net/search?q=vinyl+records&searchtype=normal&sort=recent&filters%5Brating%5D%5B%5D=all&filters%5Bdate%5D%5B%5D=30&filters%5Bdiscount%5D%5B%5D=25&filters%5Bcategory%5D%5B%5D=38296",
    country: "US",
    sourceType: "international_retailer",
    crawlType: "deal-aggregator",
    priority: 4,
    saleLikelihood: "medium",
    defaultDiscountThreshold: 0.4,
    minNetProfit: 12,
    minROI: 0.45,
    noiseLevel: "high",
    group: "Discovery sources",
    notes: "Deal aggregator retained as discovery/watchlist source; noisy title normalization.",
    salePathHints: [],
  }),
  ...[
    ["reddit-vinyl-deals", "Reddit VinylDeals", "reddit.com", "https://www.reddit.com/r/VinylDeals/"],
    ["reddit-vgm-vinyl", "Reddit VGMvinyl", "reddit.com", "https://www.reddit.com/r/VGMvinyl/"],
    ["needles-grooves-online-vinyl-deals", "Needles & Grooves Online Vinyl Deals", "needlesandgrooves.com", "https://www.needlesandgrooves.com/threads/online-vinyl-deals.34/"],
    ["steve-hoffman-coupons-discounts-sales", "Steve Hoffman Coupons Discounts & Sales", "forums.stevehoffman.tv", "https://forums.stevehoffman.tv/forums/coupons-discounts-sales.45/"],
    ["chorus-fm-vinyl-thread", "Chorus.fm Vinyl Thread", "forum.chorus.fm", "https://forum.chorus.fm/threads/vinyl-thread.70495/"],
  ].map(([id, displayName, domain, baseUrl]) =>
    source({
      id,
      displayName,
      domain,
      baseUrl,
      country: "US",
      sourceType: "international_retailer",
      crawlType: id.startsWith("reddit") ? "social-feed" : "deal-aggregator",
      priority: 4,
      saleLikelihood: "low",
      defaultDiscountThreshold: 0.4,
      minNetProfit: 12,
      minROI: 0.45,
      noiseLevel: "high",
      group: "Discovery sources",
      isDiscoveryOnly: id === "reddit-vgm-vinyl",
      notes: "Community/deal discovery source; not a direct retail catalog.",
      salePathHints: [],
    }),
  ),
];

export const sourceGroups: SourceGroup[] = [
  "Distributor networks",
  "Major label stores",
  "UK / international retailers",
  "US retailers",
  "Audiophile retailers",
  "Indie labels",
  "Metal / punk / hardcore",
  "Soundtrack / video-game labels",
  "Discovery sources",
];

export function getActiveRetailSources(): RetailArbitrageSource[] {
  const byDomain = new Map<string, RetailArbitrageSource>();
  for (const source of retailArbitrageSourceCatalog.filter((entry) => !entry.isDiscoveryOnly).sort(compareSourcePriority)) {
    if (!byDomain.has(source.domain)) byDomain.set(source.domain, source);
  }
  return [...byDomain.values()];
}

export function getSourcesByType(sourceType: RetailArbitrageSourceType): RetailArbitrageSource[] {
  return retailArbitrageSourceCatalog.filter((source) => source.sourceType === sourceType).sort(compareSourcePriority);
}

export function getSourcesByPriority(priority: SourcePriority): RetailArbitrageSource[] {
  return retailArbitrageSourceCatalog.filter((source) => source.priority === priority).sort(compareSourcePriority);
}

export function getNoisySources(): RetailArbitrageSource[] {
  return retailArbitrageSourceCatalog.filter((source) => source.noiseLevel === "high").sort(compareSourcePriority);
}

export function getSalePathHints(source: RetailArbitrageSource): string[] {
  return source.salePathHints ?? [];
}

export function getSourceGroupLabel(source: RetailArbitrageSource): SourceGroup {
  return source.group;
}

function compareSourcePriority(left: RetailArbitrageSource, right: RetailArbitrageSource): number {
  return left.priority - right.priority || left.displayName.localeCompare(right.displayName);
}

export const vinylShopSources: VinylShopSource[] = getActiveRetailSources().map((source) => ({
  id: source.id,
  name: source.displayName,
  sourceType: source.crawlType,
  url: source.baseUrl,
}));
