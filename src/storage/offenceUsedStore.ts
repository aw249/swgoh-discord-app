import { promises as fs } from 'fs';
import { dirname, join, basename } from 'path';
import { logger } from '../utils/logger';

export interface UsedHistoryEntry {
  counterLeader: string;
  addedChars: string[];
}

export interface OffenceUsedEntry {
  eventInstanceId: string;
  currentRound: number;
  usedCharacters: string[];
  history: UsedHistoryEntry[];
}

interface FileShape {
  [allyCode: string]: OffenceUsedEntry;
}

export class OffenceUsedStore {
  private cache: FileShape | null = null;

  constructor(private readonly filePath: string) {}

  async get(allyCode: string): Promise<OffenceUsedEntry | null> {
    const data = await this.load();
    return data[allyCode] ?? null;
  }

  async set(allyCode: string, entry: OffenceUsedEntry): Promise<void> {
    const data = await this.load();
    data[allyCode] = entry;
    await this.write(data);
  }

  private async load(): Promise<FileShape> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as FileShape;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`OffenceUsedStore: failed to read/parse ${this.filePath}, treating as empty`, err);
      }
      this.cache = {};
    }
    return this.cache;
  }

  private async write(data: FileShape): Promise<void> {
    const dir = dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${basename(this.filePath)}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
    this.cache = data;
  }
}
