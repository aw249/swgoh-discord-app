import { ScoutSnapshot } from '../../twInsights/types';
import { GlBreakdown } from '../../guildInsights/types';

function fmtNum(n: number): string { return n.toLocaleString('en-GB'); }
function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function patternFooter(s: ScoutSnapshot): string {
  if (!s.twAvailable) return '<div class="muted">TW data not present in payload.</div>';
  if (s.recentTwPattern.length === 0) return '<div class="muted">No recent TWs.</div>';
  return s.recentTwPattern.map(o => o === 'win' ? '🟢' : o === 'loss' ? '🔴' : '⚪').join(' ');
}

function topGls(rows: GlBreakdown[]): string {
  if (rows.length === 0) return '<div class="muted">No GLs detected.</div>';
  return rows.slice(0, 5).map(r => `<div class="row"><span>${escape(r.unitName)}</span><strong>${r.count}</strong></div>`).join('');
}

function topMembers(rows: ScoutSnapshot['guild']['topMembers']): string {
  return rows.map((m, i) => `<tr><td class="rank">${i + 1}</td><td>${escape(m.name)}</td><td class="num">${fmtNum(m.galacticPower)}</td></tr>`).join('');
}

export function scoutHtml(s: ScoutSnapshot): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body { background:#1a1a1a; color:#f5deb3; font-family:Arial,sans-serif; padding:20px; }
    h1 { color:#c4a35a; margin:0 0 4px; }
    .meta { color:#aaa; margin-bottom:16px; }
    .row-stats { display:flex; gap:16px; margin-bottom:20px; }
    .stat { background:#2a2a2a; border:1px solid #c4a35a; border-radius:6px; padding:12px 16px; flex:1; }
    .stat .label { color:#c4a35a; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
    .stat .value { font-size:22px; font-weight:bold; }
    .pattern { font-size:24px; letter-spacing:6px; }
    .section { color:#c4a35a; margin:20px 0 8px; font-weight:bold; font-size:14px; text-transform:uppercase; letter-spacing:1px; }
    .row { display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #333; width:300px; }
    .muted { color:#888; font-style:italic; }
    table { width:760px; border-collapse:collapse; }
    th,td { padding:6px 10px; border-bottom:1px solid #444; }
    th { background:#3a2a1a; text-align:left; }
    .num { text-align:right; font-variant-numeric: tabular-nums; }
    .rank { color:#c4a35a; font-weight:bold; }
  </style></head><body>
    <h1>${escape(s.guild.name)}</h1>
    <div class="meta">ID: ${escape(s.guild.id)}</div>
    <div class="row-stats">
      <div class="stat"><div class="label">Members</div><div class="value">${s.guild.memberCount}</div></div>
      <div class="stat"><div class="label">GP</div><div class="value">${fmtNum(s.guild.guildGalacticPower)}</div></div>
      <div class="stat"><div class="label">GLs</div><div class="value">${s.guild.glCount.total}</div></div>
      <div class="stat"><div class="label">Recent TW</div><div class="value pattern">${patternFooter(s)}</div></div>
    </div>
    <div class="section">Top GLs</div>
    ${topGls(s.guild.glCount.topByCount)}
    <div class="section">Top members</div>
    <table>
      <thead><tr><th>#</th><th>Player</th><th>GP</th></tr></thead>
      <tbody>${topMembers(s.guild.topMembers)}</tbody>
    </table>
  </body></html>`;
}
