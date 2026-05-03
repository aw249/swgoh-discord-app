import { AssignedCron, DatacronCandidate } from './types';

const PRIMARY_TIERS = [3, 6, 9] as const;

function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

export type CronSide = 'friendly' | 'opponent';

/** Render the accumulated stats list (one short row per stat). Empty string
 *  when the cron carries no aggregated stats. */
function renderStatsList(c: DatacronCandidate): string {
  if (c.accumulatedStats.length === 0) return '';
  const rows = c.accumulatedStats.map(s => `
    <div class="cron-cell__stat-row">
      <span class="cron-cell__stat-name">${escape(s.name)}</span>
      <span class="cron-cell__stat-value">${escape(s.displayValue)}</span>
    </div>
  `).join('');
  return `<div class="cron-cell__stats">${rows}</div>`;
}

/** Render the primary-tier ability summary (T3 / T6 / T9 with scope target).
 *  Skips tiers above currentTier and tiers without a meaningful target. */
function renderTierSummary(c: DatacronCandidate): string {
  const lines: string[] = [];
  for (const tierIndex of PRIMARY_TIERS) {
    if (c.currentTier < tierIndex) continue;
    const tier = c.tiers[tierIndex - 1];
    if (!tier?.hasData || !tier.scopeTargetName) continue;
    lines.push(
      `<div class="cron-cell__tier-row">` +
      `<span class="cron-cell__tier-label">T${tier.index}</span>` +
      `<span class="cron-cell__tier-target">${escape(tier.scopeTargetName)}</span>` +
      `</div>`
    );
  }
  if (lines.length === 0) return '';
  return `<div class="cron-cell__tiers">${lines.join('')}</div>`;
}

export function renderCronCell(assigned: AssignedCron, side: CronSide): string {
  const c = assigned.candidate;
  const sideClass = side === 'friendly' ? 'cron-cell--friendly' : 'cron-cell--opponent';
  const fillerClass = assigned.filler ? 'cron-cell--filler' : '';

  const dots = PRIMARY_TIERS.map(t => {
    const lit = c.currentTier >= t ? 'cron-cell__dot--lit' : '';
    return `<span class="cron-cell__dot ${lit}"></span>`;
  }).join('');

  const calloutImg = c.calloutImageUrl
    ? `<img class="cron-cell__callout" src="${escape(c.calloutImageUrl)}" alt="" />`
    : '';

  const fillerNote = assigned.filler
    ? `<div class="cron-cell__filler-note">(filler)</div>`
    : '';

  // Tiers + stats sit side-by-side in a single details panel (tier list on
  // the left, stats list on the right) — better use of horizontal space than
  // stacking them vertically below the art.
  const tiersHtml = renderTierSummary(c);
  const statsHtml = renderStatsList(c);
  const detailsHtml = (tiersHtml || statsHtml)
    ? `<div class="cron-cell__details">${tiersHtml}${statsHtml}</div>`
    : '';

  return `
    <div class="cron-cell ${sideClass} ${fillerClass}">
      <div class="cron-cell__art">
        <img class="cron-cell__box" src="${escape(c.boxImageUrl)}" alt="" />
        ${calloutImg}
      </div>
      <div class="cron-cell__name">${escape(c.name || `Set ${c.setId}`)}</div>
      <div class="cron-cell__dots">${dots}</div>
      ${fillerNote}
      ${detailsHtml}
    </div>
  `;
}

/** When a squad has no cron assigned, render an invisible cell that still
 *  occupies the column's reserved width so neighbouring rows stay aligned.
 *  The cell carries no inner content and is hidden via CSS (visibility) — no
 *  "No cron" placeholder, no border, but the spacing is preserved. */
export function renderEmptyCronCell(): string {
  return `<div class="cron-cell cron-cell--empty"></div>`;
}
