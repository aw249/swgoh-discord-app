import { AssignedCron } from './types';

const PRIMARY_TIERS = [3, 6, 9] as const;

function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

export type CronSide = 'friendly' | 'opponent';

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

  return `
    <div class="cron-cell ${sideClass} ${fillerClass}">
      <div class="cron-cell__art">
        <img class="cron-cell__box" src="${escape(c.boxImageUrl)}" alt="" />
        ${calloutImg}
      </div>
      <div class="cron-cell__name">${escape(c.name || `Set ${c.setId}`)}</div>
      <div class="cron-cell__dots">${dots}</div>
      ${fillerNote}
    </div>
  `;
}

export function renderEmptyCronCell(): string {
  return `
    <div class="cron-cell cron-cell--empty">
      <div class="cron-cell__placeholder">No cron</div>
    </div>
  `;
}
