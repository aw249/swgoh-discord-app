import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';

interface FileShape {
  /** Map<allyCode, Map<seasonId, cronIds[]>> serialized as nested object. */
  [allyCode: string]: { [seasonId: string]: string[] };
}

const ATOMIC_TMP_SUFFIX = '.tmp';

export class DatacronSnapshotStore {
  private cache: FileShape | null = null;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<FileShape> {
    if (this.cache) return this.cache;
    try {
      const buf = await fs.readFile(this.filePath, 'utf8');
      if (!buf.trim()) {
        this.cache = {};
        return this.cache;
      }
      this.cache = JSON.parse(buf) as FileShape;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.cache = {};
      } else {
        logger.warn('DatacronSnapshotStore: failed to read snapshot file, treating as empty:', err);
        this.cache = {};
      }
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = this.filePath + ATOMIC_TMP_SUFFIX;
    await fs.writeFile(tmp, JSON.stringify(this.cache), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async get(allyCode: string, seasonId: string): Promise<string[] | null> {
    const data = await this.load();
    const entry = data[allyCode]?.[seasonId];
    return entry ? [...entry] : null;
  }

  async set(allyCode: string, seasonId: string, cronIds: string[]): Promise<void> {
    const data = await this.load();
    if (!data[allyCode]) data[allyCode] = {};
    data[allyCode][seasonId] = [...cronIds];
    await this.persist();
  }
}
