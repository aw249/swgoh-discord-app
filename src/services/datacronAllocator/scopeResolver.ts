import { GameDataService } from '../gameDataService';
import { ResolvedScopeTarget } from './types';

/**
 * Resolves cron `scope_target_name` strings to character base IDs or category IDs
 * using gameDataService's live unit + localisation data. No hand-coded mappings.
 *
 * Reverse indexes are built lazily on first resolution and cached on the instance.
 * Construct a fresh ScopeResolver per /gac strategy invocation to pick up live data.
 */

/** Lowercase + strip spaces / hyphens / underscores. Lets us match both
 *  "Dark Side" (CG localised display name from scraped tooltip) and
 *  "darkside" (Comlink targetRule tag) to the same category id. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, '');
}

export class ScopeResolver {
  private unitNameIndex: Map<string, string> | null = null;
  private categoryNameIndex: Map<string, string> | null = null;

  private buildIndexes(): void {
    const svc = GameDataService.getInstance();
    if (!svc.isReady()) return;

    const unitIdx = new Map<string, string>();
    const allUnitIds = [...svc.getAllCharacters(), ...svc.getAllShips()];
    for (const id of allUnitIds) {
      // Index by normalised base id directly so a Comlink tag like
      // "maulhatefueled" / "krrsantan" / "vane" maps to the corresponding
      // unit when one exists.
      unitIdx.set(norm(id), id);
      const name = svc.getUnitName(id);
      if (name && name !== id) {
        unitIdx.set(norm(name), id);
      }
    }

    const categoryIdx = new Map<string, string>();
    const seenCategories = new Set<string>();
    for (const id of allUnitIds) {
      for (const c of svc.getUnitCategories(id)) seenCategories.add(c);
    }
    for (const cat of seenCategories) {
      // Direct id form: "alignment_dark" → alignment_dark
      categoryIdx.set(norm(cat), cat);
      // Localised display form: "Dark Side" / "Light Side" / "Bounty Hunter"
      const localised = svc.getLocString(`CATEGORY_${cat}_NAME`);
      if (localised) categoryIdx.set(norm(localised), cat);
      // Without the alignment_/role_/faction_/profession_ prefix:
      // alignment_dark → "dark", role_attacker → "attacker"
      const stripped = cat.replace(/^(alignment|role|faction|profession)_/, '');
      if (stripped !== cat) categoryIdx.set(norm(stripped), cat);
      // The "<x>side" form Comlink uses for alignments (lightside / darkside)
      if (cat.startsWith('alignment_')) {
        const side = cat.slice('alignment_'.length);
        categoryIdx.set(norm(side + 'side'), cat);
      }
    }

    this.unitNameIndex = unitIdx;
    this.categoryNameIndex = categoryIdx;
  }

  resolveScopeTarget(scopeTargetName: string): ResolvedScopeTarget {
    const svc = GameDataService.getInstance();
    if (!svc.isReady()) return { kind: 'unknown' };

    if (!this.unitNameIndex || !this.categoryNameIndex) this.buildIndexes();
    if (!this.unitNameIndex || !this.categoryNameIndex) return { kind: 'unknown' };

    const key = norm(scopeTargetName);
    if (!key) return { kind: 'unknown' };

    const charBaseId = this.unitNameIndex.get(key);
    if (charBaseId) return { kind: 'character', baseId: charBaseId };

    const categoryId = this.categoryNameIndex.get(key);
    if (categoryId) return { kind: 'category', categoryId };

    return { kind: 'unknown' };
  }
}
