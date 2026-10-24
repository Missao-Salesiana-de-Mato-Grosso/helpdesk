import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { CachedUser } from './jit.service.js';

const MAX_ENTRIES = 5000;

/** Cache em memória do usuário local por `sub` (RN-09). Por réplica; entre réplicas vale o TTL. */
@Injectable()
export class UserCache {
  private readonly entries = new Map<string, { value: CachedUser; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.ttlMs = config.get('AUTH_CACHE_TTL_SECONDS', { infer: true }) * 1000;
  }

  get(sub: string): CachedUser | undefined {
    const entry = this.entries.get(sub);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(sub);
      return undefined;
    }
    return entry.value;
  }

  set(sub: string, value: CachedUser): void {
    if (this.ttlMs <= 0) return;
    if (this.entries.size >= MAX_ENTRIES) this.prune();
    this.entries.set(sub, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(sub: string): void {
    this.entries.delete(sub);
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [sub, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(sub);
    }
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
  }
}
