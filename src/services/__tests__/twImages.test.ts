import { TwImageService } from '../twImages';

const itIfChromium = process.env.PUPPETEER_EXECUTABLE_PATH ? it : it.skip;

describe('TwImageService', () => {
  jest.setTimeout(20_000);

  itIfChromium('renderScout returns a PNG', async () => {
    const svc = new TwImageService();
    try {
      const buf = await svc.renderScout({
        guild: {
          id: 'g', name: 'Test', memberCount: 1, guildGalacticPower: 100,
          glCount: { total: 0, topByCount: [] },
          topMembers: [{ name: 'A', galacticPower: 100 }],
        },
        recentTwPattern: ['win', 'loss', 'win'],
        twAvailable: true,
      });
      expect(buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    } finally { await svc.close(); }
  });
});
