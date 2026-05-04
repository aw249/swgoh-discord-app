import { OffenceRosterCache } from '../offenceRosterCache';

describe('OffenceRosterCache', () => {
  it('returns a fresh fetch on first call', async () => {
    const fetcher = jest.fn().mockResolvedValue({ tag: 'r1' });
    const cache = new OffenceRosterCache({ ttlMs: 30_000, now: () => 0 });
    expect(await cache.get('111', () => fetcher())).toEqual({ tag: 'r1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves cached value within TTL', async () => {
    const fetcher = jest.fn().mockResolvedValue({ tag: 'r1' });
    let now = 0;
    const cache = new OffenceRosterCache({ ttlMs: 30_000, now: () => now });
    await cache.get('111', () => fetcher());
    now = 25_000;
    expect(await cache.get('111', () => fetcher())).toEqual({ tag: 'r1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce({ tag: 'r1' })
      .mockResolvedValueOnce({ tag: 'r2' });
    let now = 0;
    const cache = new OffenceRosterCache({ ttlMs: 30_000, now: () => now });
    await cache.get('111', () => fetcher());
    now = 31_000;
    expect(await cache.get('111', () => fetcher())).toEqual({ tag: 'r2' });
  });

  it('keys per-allyCode', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce({ tag: 'a' })
      .mockResolvedValueOnce({ tag: 'b' });
    const cache = new OffenceRosterCache({ ttlMs: 30_000, now: () => 0 });
    expect(await cache.get('111', () => fetcher())).toEqual({ tag: 'a' });
    expect(await cache.get('222', () => fetcher())).toEqual({ tag: 'b' });
  });

  it('invalidate forces a refetch', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce({ tag: 'r1' })
      .mockResolvedValueOnce({ tag: 'r2' });
    const cache = new OffenceRosterCache({ ttlMs: 30_000, now: () => 0 });
    await cache.get('111', () => fetcher());
    cache.invalidate('111');
    expect(await cache.get('111', () => fetcher())).toEqual({ tag: 'r2' });
  });
});
