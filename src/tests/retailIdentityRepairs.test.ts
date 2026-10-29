import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairRetailCandidateIdentity } from '../../scripts/lib/retailIdentityRepairs.mjs';

describe('observed retail identity repair before research', () => {
  const listing = 'John Coltrane / Blue Train: The Complete Masters 180 Gram Vinyl Record Stereo Version + Bound Booklet';
  it('corrects a retailer identity and drops prices and supply for the old identity', () => {
    const original = { id: 'same-selected-id', sourceId: 'acoustic-sounds', sourceUrl: 'https://store.acousticsounds.com/d/170801/example',
      sourceListingTitle: listing, artist: 'John Coltrane / Blue Train', title: 'The Complete Masters', purchasePrice: 38.49,
      capturedAt: '2026-10-29T13:13:00.000Z', averageSoldPrice: 80, conservativeResalePrice: 80,
      activeEvidence: { status: 'available', searchComplete: true }, lowestActivePrice: 90, ebayActiveSearchComplete: true,
      albumDemand: { matched: true }, researchQuery: 'bad query' };
    const repaired = repairRetailCandidateIdentity(original);
    expect(repaired).toMatchObject({ id: original.id, artist: 'John Coltrane', title: 'Blue Train: The Complete Masters',
      purchasePrice: original.purchasePrice, capturedAt: original.capturedAt, conservativeResalePrice: null });
    expect(repaired.retailEditionText).toContain('Stereo Version');
    expect(repaired.activeEvidence?.searchComplete).not.toBe(true);
    expect(repaired.lowestActivePrice).not.toBe(90);
    expect(repaired.albumDemand).toBeUndefined();
    expect(repaired.researchQuery).toBeUndefined();
    expect(original.averageSoldPrice).toBe(80);
    expect(repairRetailCandidateIdentity(repaired)).toEqual(repaired);
  });
  it('retains exact research when no observed identity has changed', () => {
    const original = { sourceId: 'other-shop', sourceListingTitle: listing, artist: 'Artist A / Artist B', title: 'Album',
      conservativeResalePrice: 25, activeEvidence: { status: 'available', searchComplete: true } };
    expect(repairRetailCandidateIdentity(original)).toBe(original);
  });
  it('repairs an unpublished draft through the guarded CLI without requiring an API request', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'retail-identity-repair-'));
    try {
      const path = join(workspace, 'draft.json');
      const find = { id: 'selected', sourceId: 'acoustic-sounds', sourceListingTitle: listing,
        artist: 'John Coltrane / Blue Train', title: 'The Complete Masters', purchasePrice: 38.49 };
      const draft = { phase: 'scan', runId: 'same-run', createdAt: '2026-10-29T13:13:00.000Z',
        researchCandidates: [find], finds: [find] };
      writeFileSync(path, JSON.stringify(draft));
      const result = spawnSync(process.execPath, [join(process.cwd(), 'scripts/enrichRetailReleaseIdentity.mjs'), path],
        { cwd: workspace, encoding: 'utf8', windowsHide: true });
      expect(result.status, result.stderr).toBe(0);
      const repaired = JSON.parse(readFileSync(path, 'utf8'));
      expect(repaired).toMatchObject({ phase: 'scan', runId: draft.runId, createdAt: draft.createdAt });
      for (const row of [repaired.finds[0], repaired.researchCandidates[0]])
        expect(row).toMatchObject({ id: 'selected', artist: 'John Coltrane', title: 'Blue Train: The Complete Masters', purchasePrice: 38.49 });
      expect(JSON.parse(result.stdout)).toMatchObject({ checked: 0, pending: 0, localRepairs: 2 });
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
});
