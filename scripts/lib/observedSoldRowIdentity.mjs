const DAY = 86400000;
const clean = value => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

// Seller Hub retains older sales after their listing links disappear. Only an
// explicitly observed, complete annual table may use its displayed row instead.
// These signatures stay inside capture validation; they are never item IDs.
export function observedSoldRowIdentities(run, window) {
  const rows = Array.isArray(run.rows) ? run.rows : [];
  const identities = rows.map(row => {
    const url = String(row.itemUrl ?? row.href ?? row.url ?? "");
    const id = url.match(/^https:\/\/(?:www\.)?ebay\.com\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?#]|$)/)?.[1];
    if (id) return `item:${id}`;
    const cells = row.cells;
    const date = Date.parse(row.dateLastSold ?? cells?.[7]);
    if (url || row.listingLinkUnavailable !== true || run.captureMethod !== "visible_browser" ||
        run.completePagination !== true || !window || window.duration < 365 ||
        !Array.isArray(cells) || cells.length !== 8 ||
        !Number.isFinite(date) || date < window.start || date > window.end - 90 * DAY) return null;
    return `observed:${rowSignature(row)}`;
  });
  const linked = identities.filter(Boolean);
  let duplicate = new Set(linked).size !== linked.length;
  // Also catch a repeated row when one page had a link and another did not.
  const signatures = rows.map(rowSignature);
  identities.forEach((identity, index) => {
    if (identity?.startsWith("observed:") && signatures.some((signature, other) => other !== index && signature === signatures[index])) duplicate = true;
  });
  return { missing: identities.some(identity => !identity), duplicate };
}

function rowSignature(row) {
  const cells = row.cells ?? [];
  return JSON.stringify([0, 2, 3, 4, 5, 7].map(index => clean(cells[index])));
}
