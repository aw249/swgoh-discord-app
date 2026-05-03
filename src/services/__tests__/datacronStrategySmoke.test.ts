import { BrowserService } from '../browserService';
import { renderCronCell, renderEmptyCronCell, AssignedCron, DatacronCandidate } from '../datacronAllocator';

const itIfChromium = process.env.PUPPETEER_EXECUTABLE_PATH ? it : it.skip;

const sampleCron: DatacronCandidate = {
  source: 'scraped', id: 'c1', setId: 28, focused: true, currentTier: 9,
  name: 'Power for Hire',
  tiers: Array.from({ length: 9 }, (_, i) => ({
    index: i + 1, targetRuleId: '', abilityId: '', scopeTargetName: '', hasData: true,
  })),
  boxImageUrl: 'https://game-assets.swgoh.gg/textures/tex.datacron_d_max.png',
  calloutImageUrl: 'https://game-assets.swgoh.gg/textures/tex.charui_krrsantan.png',
  accumulatedStats: [],
};

describe('datacron cron-cell smoke render', () => {
  jest.setTimeout(20_000);

  itIfChromium('renders friendly + opponent + empty cells side-by-side', async () => {
    const friendly: AssignedCron = { candidate: sampleCron, score: 38, filler: false };
    const opp: AssignedCron = { candidate: { ...sampleCron, name: 'Opponent Cron' }, score: 0, filler: false };
    const html = `<!DOCTYPE html><html><head><style>
      body { background:#1a1a1a; color:#f5deb3; font-family:Arial,sans-serif; padding:20px; display:flex; gap:20px; }
      .cron-cell { display:flex; flex-direction:column; align-items:center; width:100px; padding:4px;
        border:2px solid transparent; border-radius:4px; background:rgba(0,0,0,0.18); }
      .cron-cell--friendly { border-color:#c4a35a; }
      .cron-cell--opponent { border-color:#b13c3c; }
      .cron-cell--empty { opacity:0.3; }
      .cron-cell__art { position:relative; width:80px; height:80px; }
      .cron-cell__box { width:100%; height:100%; object-fit:contain; }
      .cron-cell__callout { position:absolute; bottom:-6px; right:-6px; width:36px; height:36px;
        border-radius:50%; border:2px solid #1a1a1a; }
      .cron-cell__name { font-size:11px; font-weight:600; margin-top:6px; text-align:center; max-width:96px; word-break:break-word; }
      .cron-cell__dots { display:flex; gap:4px; margin-top:4px; }
      .cron-cell__dot { width:6px; height:6px; border-radius:50%; background:#444; }
      .cron-cell__dot--lit { background:#c4a35a; }
      .cron-cell__placeholder { font-size:11px; color:#888; padding:28px 4px; text-align:center; }
    </style></head><body>
      ${renderCronCell(friendly, 'friendly')}
      ${renderCronCell(opp, 'opponent')}
      ${renderEmptyCronCell()}
    </body></html>`;

    const svc = new BrowserService();
    try {
      const buf = await svc.renderHtml(html, { width: 360, height: 200 });
      expect(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    } finally { await svc.close(); }
  });
});
