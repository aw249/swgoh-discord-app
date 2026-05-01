import { ReadyCheckRow } from '../../guildInsights/types';

function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export function readyCheckHtml(rows: ReadyCheckRow[], guildName: string, unitName: string, minRelic: number): string {
  const passing = rows.filter(r => r.found);
  const missing = rows.filter(r => !r.found);

  const passingBody = passing.map(r => `
    <tr><td>${escape(r.playerName)}</td><td class="num">${r.rarity}★</td>
        <td class="num">G${r.gearLevel}</td><td class="num">R${r.relicTier}</td>
        <td class="num">${r.zetaCount}</td><td class="num">${r.omicronCount}</td></tr>
  `).join('');

  const missingBody = missing.length
    ? `<h2>Below R${minRelic}</h2><ul>${missing.map(m => `<li>${escape(m.playerName)}</li>`).join('')}</ul>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body { background:#1a1a1a; color:#f5deb3; font-family:Arial,sans-serif; padding:20px; }
    h1 { color:#c4a35a; margin:0 0 8px; } h2 { color:#c4a35a; margin:24px 0 8px; font-size:18px; }
    .meta { color:#aaa; margin-bottom:16px; }
    table { width:860px; border-collapse:collapse; }
    th,td { padding:6px 10px; border-bottom:1px solid #444; }
    th { background:#3a2a1a; text-align:left; }
    .num { text-align:right; font-variant-numeric: tabular-nums; }
    ul { columns: 3; }
  </style></head><body>
    <h1>${escape(guildName)} — ${escape(unitName)} ready-check</h1>
    <div class="meta">${passing.length} qualifying member(s) at R${minRelic}+</div>
    <table>
      <thead><tr><th>Player</th><th>★</th><th>Gear</th><th>Relic</th><th>Zetas</th><th>Omis</th></tr></thead>
      <tbody>${passingBody}</tbody>
    </table>
    ${missingBody}
  </body></html>`;
}
