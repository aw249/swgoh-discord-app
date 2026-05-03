import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatacronSnapshotStore } from '../../storage/datacronSnapshotStore';

describe('DatacronSnapshotStore', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-snap-'));
    storePath = path.join(dir, 'snapshots.json');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {/* ignore */}
  });

  it('returns null when no snapshot exists for the key', async () => {
    const store = new DatacronSnapshotStore(storePath);
    expect(await store.get('111111111', 'SEASON_X')).toBeNull();
  });

  it('returns the saved snapshot after set', async () => {
    const store = new DatacronSnapshotStore(storePath);
    await store.set('111111111', 'SEASON_X', ['cron-a', 'cron-b', 'cron-c']);
    expect(await store.get('111111111', 'SEASON_X')).toEqual(['cron-a', 'cron-b', 'cron-c']);
  });

  it('keeps separate snapshots per (allyCode, seasonId)', async () => {
    const store = new DatacronSnapshotStore(storePath);
    await store.set('111111111', 'SEASON_X', ['a']);
    await store.set('222222222', 'SEASON_X', ['b']);
    await store.set('111111111', 'SEASON_Y', ['c']);
    expect(await store.get('111111111', 'SEASON_X')).toEqual(['a']);
    expect(await store.get('222222222', 'SEASON_X')).toEqual(['b']);
    expect(await store.get('111111111', 'SEASON_Y')).toEqual(['c']);
  });

  it('persists across instances (reads from disk on construction)', async () => {
    const a = new DatacronSnapshotStore(storePath);
    await a.set('111111111', 'SEASON_X', ['cron-a']);
    const b = new DatacronSnapshotStore(storePath);
    expect(await b.get('111111111', 'SEASON_X')).toEqual(['cron-a']);
  });

  it('overwrites when set is called again for the same key', async () => {
    const store = new DatacronSnapshotStore(storePath);
    await store.set('111111111', 'SEASON_X', ['a']);
    await store.set('111111111', 'SEASON_X', ['b', 'c']);
    expect(await store.get('111111111', 'SEASON_X')).toEqual(['b', 'c']);
  });

  it('survives a missing or empty file', async () => {
    fs.writeFileSync(storePath, '');
    const store = new DatacronSnapshotStore(storePath);
    expect(await store.get('111111111', 'SEASON_X')).toBeNull();
    await store.set('111111111', 'SEASON_X', ['x']);
    expect(await store.get('111111111', 'SEASON_X')).toEqual(['x']);
  });
});
