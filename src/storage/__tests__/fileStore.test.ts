import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// We need to import FilePlayerStore — it's not exported yet, so this will fail initially.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FilePlayerStore } = require('../fileStore');

async function makeTempFile(content?: object): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'filestore-test-'));
  const filePath = join(dir, 'players.json');
  if (content !== undefined) {
    await fs.writeFile(filePath, JSON.stringify(content), 'utf-8');
  }
  return filePath;
}

describe('FilePlayerStore', () => {
  const FIXED_NOW = '2026-05-04T12:00:00.000Z';
  const mockNow = () => new Date(FIXED_NOW);

  describe('auto-migration from old flat shape', () => {
    it('migrates a flat { userId: allyCode } file on first read', async () => {
      const filePath = await makeTempFile({ '111': '123456789', '222': '987654321' });
      const store = new FilePlayerStore(filePath, mockNow);

      // Reading triggers ensureInitialized + migration
      const code = await store.getAllyCode('111');
      expect(code).toBe('123456789');

      // File should now be in new shape
      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(raw['111']).toEqual({ allyCode: '123456789', registeredAt: FIXED_NOW, legacy: true });
      expect(raw['222']).toEqual({ allyCode: '987654321', registeredAt: FIXED_NOW, legacy: true });
    });

    it('does not re-migrate a file already in new shape', async () => {
      const existing = {
        '111': { allyCode: '123456789', registeredAt: '2025-01-01T00:00:00.000Z', legacy: true }
      };
      const filePath = await makeTempFile(existing);
      const statBefore = await fs.stat(filePath);

      // Small delay to ensure mtime would differ if file was re-written
      await new Promise(r => setTimeout(r, 50));

      const store = new FilePlayerStore(filePath, mockNow);
      await store.getAllyCode('111');

      const statAfter = await fs.stat(filePath);
      // File should NOT have been rewritten
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(raw['111'].registeredAt).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('getAllyCode', () => {
    it('returns the ally code for a registered player', async () => {
      const filePath = await makeTempFile({ '111': '123456789' });
      const store = new FilePlayerStore(filePath, mockNow);
      expect(await store.getAllyCode('111')).toBe('123456789');
    });

    it('returns null for an unknown user', async () => {
      const filePath = await makeTempFile({});
      const store = new FilePlayerStore(filePath, mockNow);
      expect(await store.getAllyCode('999')).toBeNull();
    });

    it('returns ally code correctly from a file already in new shape', async () => {
      const filePath = await makeTempFile({
        '333': { allyCode: '555555555', registeredAt: '2025-06-01T00:00:00.000Z', legacy: true }
      });
      const store = new FilePlayerStore(filePath, mockNow);
      expect(await store.getAllyCode('333')).toBe('555555555');
    });
  });

  describe('getAllAllyCodes', () => {
    it('returns all ally codes post-migration', async () => {
      const filePath = await makeTempFile({ '111': '111111111', '222': '222222222' });
      const store = new FilePlayerStore(filePath, mockNow);
      const codes = await store.getAllAllyCodes();
      expect(codes.sort()).toEqual(['111111111', '222222222']);
    });

    it('returns empty array when no players registered', async () => {
      const filePath = await makeTempFile({});
      const store = new FilePlayerStore(filePath, mockNow);
      expect(await store.getAllAllyCodes()).toEqual([]);
    });
  });

  describe('registerPlayer', () => {
    it('creates a new registration with registeredAt and legacy=true (early-adopter window open)', async () => {
      const filePath = await makeTempFile({});
      const store = new FilePlayerStore(filePath, mockNow);

      await store.registerPlayer('444', '444444444');

      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(raw['444']).toEqual({ allyCode: '444444444', registeredAt: FIXED_NOW, legacy: true });
    });

    it('preserves original registeredAt when player re-registers', async () => {
      const originalDate = '2024-01-01T00:00:00.000Z';
      const filePath = await makeTempFile({
        '555': { allyCode: '111111111', registeredAt: originalDate }
      });
      const store = new FilePlayerStore(filePath, mockNow);

      await store.registerPlayer('555', '999999999');

      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(raw['555'].allyCode).toBe('999999999');
      expect(raw['555'].registeredAt).toBe(originalDate);
    });

    it('preserves legacy flag when player re-registers', async () => {
      const filePath = await makeTempFile({
        '666': { allyCode: '111111111', registeredAt: '2024-01-01T00:00:00.000Z', legacy: true }
      });
      const store = new FilePlayerStore(filePath, mockNow);

      await store.registerPlayer('666', '777777777');

      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(raw['666'].legacy).toBe(true);
    });
  });

  describe('atomic write', () => {
    it('leaves no .tmp file after registerPlayer', async () => {
      const filePath = await makeTempFile({});
      const store = new FilePlayerStore(filePath, mockNow);

      await store.registerPlayer('777', '777777777');

      await expect(fs.access(`${filePath}.tmp`)).rejects.toThrow();
    });
  });

  describe('getRegistration', () => {
    it('returns full registration object for an existing user', async () => {
      const filePath = await makeTempFile({
        '888': { allyCode: '888888888', registeredAt: '2025-03-01T00:00:00.000Z', legacy: true }
      });
      const store = new FilePlayerStore(filePath, mockNow);

      const reg = await store.getRegistration('888');
      expect(reg).toEqual({ allyCode: '888888888', registeredAt: '2025-03-01T00:00:00.000Z', legacy: true });
    });

    it('returns null for a missing user', async () => {
      const filePath = await makeTempFile({});
      const store = new FilePlayerStore(filePath, mockNow);

      expect(await store.getRegistration('nonexistent')).toBeNull();
    });

    it('returns registration for a newly registered player (currently flagged legacy=true while early-adopter window is open)', async () => {
      const filePath = await makeTempFile({});
      const store = new FilePlayerStore(filePath, mockNow);

      await store.registerPlayer('999', '999999999');
      const reg = await store.getRegistration('999');

      expect(reg).toEqual({ allyCode: '999999999', registeredAt: FIXED_NOW, legacy: true });
    });
  });
});
