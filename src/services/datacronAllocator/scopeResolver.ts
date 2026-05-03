import { GameDataService } from '../gameDataService';
import { ResolvedScopeTarget } from './types';

/**
 * Resolves cron `scope_target_name` strings to character base IDs or category IDs
 * using gameDataService's live unit + localisation data. No hand-coded mappings.
 *
 * Reverse indexes are built lazily on first resolution and cached on the instance.
 * Construct a fresh ScopeResolver per /gac strategy invocation to pick up live data.
 */
export class ScopeResolver {
  private unitNameIndex: Map<string, string> | null = null;
  private categoryNameIndex: Map<string, string> | null = null;

  private buildIndexes(): void {
    const svc = GameDataService.getInstance();
    if (!svc.isReady()) return;

    const unitIdx = new Map<string, string>();
    const allUnitIds = [...svc.getAllCharacters(), ...svc.getAllShips()];
    for (const id of allUnitIds) {
      const name = svc.getUnitName(id);
      if (name && name !== id) {
        unitIdx.set(name.toLowerCase(), id);
      }
    }

    const categoryIdx = new Map<string, string>();
    const seenCategories = new Set<string>();
    for (const id of allUnitIds) {
      for (const c of svc.getUnitCategories(id)) seenCategories.add(c);
    }
    for (const cat of seenCategories) {
      const localised = svc.getLocString(`CATEGORY_${cat}_NAME`);
      if (localised) categoryIdx.set(localised.toLowerCase(), cat);
    }

    this.unitNameIndex = unitIdx;
    this.categoryNameIndex = categoryIdx;
  }

  resolveScopeTarget(scopeTargetName: string): ResolvedScopeTarget {
    const svc = GameDataService.getInstance();
    if (!svc.isReady()) return { kind: 'unknown' };

    if (!this.unitNameIndex || !this.categoryNameIndex) this.buildIndexes();
    if (!this.unitNameIndex || !this.categoryNameIndex) return { kind: 'unknown' };

    const key = scopeTargetName.trim().toLowerCase();
    if (!key) return { kind: 'unknown' };

    const charBaseId = this.unitNameIndex.get(key);
    if (charBaseId) return { kind: 'character', baseId: charBaseId };

    const categoryId = this.categoryNameIndex.get(key);
    if (categoryId) return { kind: 'category', categoryId };

    return { kind: 'unknown' };
  }
}
