import NodeCache from "node-cache";
/**
 * Intelligent Caching Service for SAIJ API responses.
 * Default TTL: 24 hours (86400 seconds)
 */
export class CacheService {
    cache;
    constructor(ttlSeconds = 86400) {
        this.cache = new NodeCache({
            stdTTL: ttlSeconds,
            checkperiod: ttlSeconds * 0.2,
            useClones: false,
        });
    }
    get(key) {
        return this.cache.get(key);
    }
    set(key, value) {
        return this.cache.set(key, value);
    }
    has(key) {
        return this.cache.has(key);
    }
    flush() {
        this.cache.flushAll();
    }
}
// Export a singleton instance
export const cacheService = new CacheService();
