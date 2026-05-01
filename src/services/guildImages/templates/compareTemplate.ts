import { GuildCompareSummary, GlBreakdown } from '../../guildInsights/types';

function fmtNum(n: number): string { return n.toLocaleString('en-GB'); }
function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function topGlsRow(top: GlBreakdown[]): string {
  if (top.length === 0) return '<div class="muted">No GLs detected.</div>';
  return top.slice(0, 5).map(g => `<div class="gl-row"><span>${escape(g.unitName)}</span><strong>${g.count}</strong></div>`).join('');
}

function topMembersRow(rows: Array<{ name: string; galacticPower: number }>): string {
  return rows.map((m, i) => `<tr><td class="rank">${i + 1}</td><td>${escape(m.name)}</td><td class="num">${fmtNum(m.galacticPower)}</td></tr>`).join('');
}

export function compareHtml(s: GuildCompareSummary): string {
  const card = (label: string, snap: GuildCompareSummary['a']) => `
    <div class="card">
      <div class="label">${label}</div>
      <h2>${escape(snap.name)}</h2>
      <div class="row"><span>GP</span><strong>${fmtNum(snap.guildGalacticPower)}</strong></div>
      <div class="row"><span>Members</span><strong>${snap.memberCount}</strong></div>
      <div class="row"><span>GLs</span><strong>${snap.glCount.total}</strong></div>
      <div class="section">Top GLs</div>
      ${topGlsRow(snap.glCount.topByCount)}
      <div class="section">Top members</div>
      <table class="members">
        <thead><tr><th>#</th><th>Player</th><th>GP</th></tr></thead>
        <tbody>${topMembersRow(snap.topMembers)}</tbody>
      </table>
    </div>`;

  const sign = (n: number) => (n >= 0 ? '+' : '') + fmtNum(n);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body { background:#1a1a1a; color:#f5deb3; font-family:Arial,sans-serif; padding:20px;
           display:flex; flex-direction:column; align-items:center; }
    .row-cards { display:flex; gap:20px; }
    .card { background:#2a2a2a; border:2px solid #c4a35a; border-radius:8px; padding:20px; width:480px; }
    .label { color:#c4a35a; font-size:13px; letter-spacing:1px; text-transform:uppercase; }
    h2 { margin:8px 0 16px; }
    .row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #444; }
    .section { color:#c4a35a; margin:14px 0 6px; font-weight:bold; font-size:13px; text-transform:uppercase; letter-spacing:1px; }
    .gl-row { display:flex; justify-content:space-between; padding:3px 0; }
    .muted { color:#888; font-style:italic; }
    table.members { width:100%; border-collapse:collapse; margin-top:6px; }
    table.members th,table.members td { padding:4px 8px; border-bottom:1px solid #333; }
    table.members th { background:#3a2a1a; text-align:left; }
    .num { text-align:right; font-variant-numeric: tabular-nums; }
    .rank { color:#c4a35a; font-weight:bold; }
    .delta { margin-top:20px; color:#c4a35a; font-size:16px; }
  </style></head><body>
    <div class="row-cards">
      ${card('Guild A', s.a)}
      ${card('Guild B', s.b)}
    </div>
    <div class="delta">A − B: GP ${sign(s.gpDelta)} • Members ${sign(s.memberDelta)} • GLs ${sign(s.glDelta)}</div>
  </body></html>`;
}
