/**
 * Datacron utilities — derive which characters the user's focused datacrons
 * empower, and which characters ANY focused datacron in the meta empowers.
 * Used to filter counters that depend on a datacron the user lacks.
 *
 * The datacron API exposes:
 *   - `focused: boolean` — only true when level-9 ability is committed; base
 *     datacrons contribute stats only
 *   - `tag: string[]` — semantic theme like ["maulhatefueled"], ["bobafett"]
 *   - `templateId: string` — references a comlink datacronTemplate
 *
 * Comlink's data segment 4 exposes `datacronTemplate[]` — each with a
 * `fixedTag[]` that names the cron's theme (mostly a character or duo name
 * like "bobafett", "wampa"). The same string appears on owned datacrons in
 * `tag[]`. So we can use the union of ALL focused-template fixedTags as
 * "the meta's set of cron-leverageable themes" and the user's focused-cron
 * tags as the subset they own.
 *
 * Tag → character mapping uses substring match against actual roster base
 * IDs (≥4-char fragment). Most tags are direct character names (bobafett→
 * BOBAFETT) so the match is exact. A few tags are themed phrases (e.g.
 * "vaderduelsend"); the substring match catches the common case
 * "vader"→LORDVADER but won't catch every game-internal name remap.
 */

import { ComlinkDatacron } from '../../../integrations/comlink/comlinkClient';

const MIN_NAME_FRAGMENT_LENGTH = 4;

/**
 * Internal: match a single tag against roster base IDs.
 * EXACT match only: the tag (lowercased) must equal the base ID (lowercased).
 *
 * Substring matching produced too many false positives — "stormtrooperluke"
 * matched GRANDMASTERLUKE via the "luke" suffix; "vaderduelsend" matched
 * any character with "vader" in their name. The filter dropped legit
 * counters that didn't actually need a datacron.
 *
 * Trade-off: themed cron tags ("vaderduelsend", "maulhatefueled") that
 * aren't direct character names won't match anything. The cron-leverage
 * set under-counts in those cases, which means the filter under-filters
 * (we may recommend a counter that DOES need a cron). That's the safer
 * direction — better to recommend a cron-dependent counter than to drop
 * a usable one.
 */
function charactersForTag(tag: string, candidateBaseIds: Iterable<string>): Set<string> {
  const matched = new Set<string>();
  const lcTag = tag.toLowerCase();
  if (!lcTag || lcTag.length < MIN_NAME_FRAGMENT_LENGTH) return matched;
  for (const baseId of candidateBaseIds) {
    if (baseId.toLowerCase() === lcTag) {
      matched.add(baseId);
    }
  }
  return matched;
}

/**
 * Returns the set of character base IDs whose name appears in any focused
 * datacron tag the player owns. These are the characters the player's
 * datacrons are configured to power up.
 */
export function extractDatacronLeveragedCharacters(
  datacrons: ComlinkDatacron[] | undefined,
  candidateBaseIds: Iterable<string>
): Set<string> {
  const leveraged = new Set<string>();
  if (!datacrons || datacrons.length === 0) return leveraged;
  for (const cron of datacrons) {
    if (!cron.focused) continue;
    for (const tag of cron.tag ?? []) {
      for (const c of charactersForTag(tag, candidateBaseIds)) {
        leveraged.add(c);
      }
    }
  }
  return leveraged;
}

/**
 * Returns the set of character base IDs that ANY focused datacron template
 * in the meta empowers — the full pool of "could be cron-leveraged in
 * current game state". `metaCronTags` is the union of fixedTag values from
 * all focused datacronTemplate entries (provided by the caller from
 * comlink's data segment 4).
 */
export function extractMetaActivatedCharacters(
  metaCronTags: Iterable<string>,
  candidateBaseIds: Iterable<string>
): Set<string> {
  const baseIdsArr = Array.from(candidateBaseIds);
  const activated = new Set<string>();
  for (const tag of metaCronTags) {
    for (const c of charactersForTag(tag, baseIdsArr)) {
      activated.add(c);
    }
  }
  return activated;
}

/**
 * Heuristic fallback: a counter "looks datacron-dependent" when its win
 * rate is suspiciously high relative to its sample size. Used in addition
 * to the meta-tag check to catch niche untested compositions.
 */
export function looksDatacronDependent(
  winPercentage: number | null,
  seenCount: number | null
): boolean {
  if (winPercentage === null || winPercentage < 90) return false;
  if (seenCount === null) return true;
  return seenCount < 100;
}
