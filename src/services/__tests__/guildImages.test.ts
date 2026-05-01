import { GuildImageService } from '../guildImages';

const itIfChromium = process.env.PUPPETEER_EXECUTABLE_PATH ? it : it.skip;

describe('GuildImageService', () => {
  jest.setTimeout(20_000);

  itIfChromium('renderReadyCheck produces a PNG', async () => {
    const svc = new GuildImageService();
    try {
      const buf = await svc.renderReadyCheck(
        [{ playerName: 'A', found: true, rarity: 7, gearLevel: 13, relicTier: 9, zetaCount: 3, omicronCount: 1 }],
        'Test Guild', 'Rey', 5
      );
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    } finally { await svc.close(); }
  });
});
