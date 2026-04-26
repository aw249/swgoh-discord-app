/**
 * Datacron utilities — extract semantic signals from a player's datacron
 * grid so the counter selector can flag datacron-dependent recommendations
 * the player can't actually run.
 *
 * The datacron API exposes:
 *   - `focused: boolean` — only true when level-9 ability is committed; base
 *     datacrons contribute stats only and shouldn't influence squad-defining
 *     decisions
 *   - `tag: string[]` — semantic hints like ["maulhatefueled"], ["vaderduelsend"],
 *     ["wampa"], ["baylanskoll"], ["ig90"]
 *
 * Mapping a tag to the characters it leverages is heuristic — there's no
 * structured mapping in the game data we currently ingest. Substring match
 * against character base IDs handles the common cases (vader→LORDVADER,
 * boba→BOBAFETT, etc.) but will miss non-name-based tags. That's acceptable
 * for warning-only behaviour: a missed match means we don't suppress a real
 * warning, and a hit means we suppress a likely-false-positive.
 */

import { ComlinkDatacron } from '../../../integrations/comlink/comlinkClient';

const MIN_NAME_FRAGMENT_LENGTH = 4;

/**
 * Returns the set of character base IDs whose name appears (as a >=4 char
 * lowercase substring) in any focused datacron tag the player owns. These
 * are the characters whose squads the player's datacrons are configured to
 * power up.
 */
export function extractDatacronLeveragedCharacters(
  datacrons: ComlinkDatacron[] | undefined,
  candidateBaseIds: Iterable<string>
): Set<string> {
  const leveraged = new Set<string>();
  if (!datacrons || datacrons.length === 0) return leveraged;

  const focusedTags: string[] = [];
  for (const cron of datacrons) {
    if (!cron.focused) continue;
    for (const tag of cron.tag ?? []) {
      const lc = tag.toLowerCase();
      if (lc) focusedTags.push(lc);
    }
  }
  if (focusedTags.length === 0) return leveraged;

  for (const baseId of candidateBaseIds) {
    if (leveraged.has(baseId)) continue;
    const lcBase = baseId.toLowerCase();
    // Cheapest path: exact baseId substring in a tag
    if (focusedTags.some(t => t.includes(lcBase))) {
      leveraged.add(baseId);
      continue;
    }
    // Fallback: a >=4-char substring of the baseId appears in a tag.
    // Catches cases like baseId=DARTHMAUL, tag=maulhatefueled (matches "maul"
    // or "darthmaul" — only "darthmaul" is exact, "maul" is substring).
    for (let i = 0; i + MIN_NAME_FRAGMENT_LENGTH <= lcBase.length; i++) {
      const fragment = lcBase.slice(i, lcBase.length);
      if (fragment.length < MIN_NAME_FRAGMENT_LENGTH) break;
      if (focusedTags.some(t => t.includes(fragment))) {
        leveraged.add(baseId);
        break;
      }
    }
  }
  return leveraged;
}

/**
 * Heuristic: a counter "looks datacron-dependent" when its win rate is
 * suspiciously high relative to its sample size. Without enough plays to
 * back the rate, an extreme win % usually means the players who DO run it
 * are the ones who have specific datacrons; otherwise it'd be played and
 * tested more broadly.
 */
export function looksDatacronDependent(
  winPercentage: number | null,
  seenCount: number | null
): boolean {
  if (winPercentage === null || winPercentage < 90) return false;
  if (seenCount === null) return true;
  return seenCount < 100;
}
