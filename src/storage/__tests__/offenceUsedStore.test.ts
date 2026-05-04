import { OffenceUsedStore } from '../offenceUsedStore';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

async function freshStore(): Promise<{ store: OffenceUsedStore; path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'offenceUsed-'));
  const path = join(dir, 'offence-used.json');
  return {
    store: new OffenceUsedStore(path),
    path,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

describe('OffenceUsedStore', () => {
  it('returns null when the file does not exist', async () => {
    const { store, cleanup } = await freshStore();
    try {
      expect(await store.get('111')).toBeNull();
    } finally { await cleanup(); }
  });

  it('persists and reads back a single ally entry', async () => {
    const { store, cleanup } = await freshStore();
    try {
      await store.set('111', {
        eventInstanceId: 'CW21:O1',
        currentRound: 2,
        usedCharacters: ['GLREY', 'EZRA'],
        history: [{ counterLeader: 'GLREY', addedChars: ['GLREY', 'EZRA'] }],
      });
      const got = await store.get('111');
      expect(got).toEqual({
        eventInstanceId: 'CW21:O1',
        currentRound: 2,
        usedCharacters: ['GLREY', 'EZRA'],
        history: [{ counterLeader: 'GLREY', addedChars: ['GLREY', 'EZRA'] }],
      });
    } finally { await cleanup(); }
  });

  it('keeps separate entries per ally', async () => {
    const { store, cleanup } = await freshStore();
    try {
      await store.set('111', { eventInstanceId: 'A', currentRound: 1, usedCharacters: ['A'], history: [] });
      await store.set('222', { eventInstanceId: 'B', currentRound: 2, usedCharacters: ['B'], history: [] });
      expect(await store.get('111')).toMatchObject({ eventInstanceId: 'A' });
      expect(await store.get('222')).toMatchObject({ eventInstanceId: 'B' });
    } finally { await cleanup(); }
  });

  it('overwrites an existing entry on set', async () => {
    const { store, cleanup } = await freshStore();
    try {
      await store.set('111', { eventInstanceId: 'A', currentRound: 1, usedCharacters: ['A'], history: [] });
      await store.set('111', { eventInstanceId: 'B', currentRound: 2, usedCharacters: ['B'], history: [] });
      expect(await store.get('111')).toMatchObject({ eventInstanceId: 'B', usedCharacters: ['B'] });
    } finally { await cleanup(); }
  });

  it('writes atomically (no .tmp file remains after success)', async () => {
    const { store, path, cleanup } = await freshStore();
    try {
      await store.set('111', { eventInstanceId: 'A', currentRound: 1, usedCharacters: [], history: [] });
      const dir = path.replace(/\/[^/]+$/, '');
      const entries = await fs.readdir(dir);
      expect(entries.filter(e => e.endsWith('.tmp'))).toHaveLength(0);
    } finally { await cleanup(); }
  });

  it('treats a corrupt JSON file as empty (does not throw)', async () => {
    const { store, path, cleanup } = await freshStore();
    try {
      await fs.writeFile(path, '{not valid json');
      expect(await store.get('111')).toBeNull();
    } finally { await cleanup(); }
  });
});
