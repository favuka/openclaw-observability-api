type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export class MemoryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  async getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.value as T;
    }

    const value = await loader();
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}

export const cache = new MemoryCache();
