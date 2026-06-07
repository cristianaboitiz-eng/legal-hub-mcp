import axios from "axios";
import { CONFIG } from "../config.js";
import { cacheService } from "./cache-service.js";
/**
 * Base SAIJ API Client with rate limiting, common headers, and intelligent caching
 */
export class ApiClient {
    client;
    lastRequestTime = 0;
    rateLimitDelay;
    constructor() {
        this.rateLimitDelay = 1000 / CONFIG.RATE_LIMIT;
        this.client = axios.create({
            baseURL: CONFIG.BASE_URL,
            timeout: CONFIG.TIMEOUT,
            headers: {
                "User-Agent": CONFIG.DEFAULT_USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
                "Origin": CONFIG.BASE_URL,
                "Referer": `${CONFIG.BASE_URL}/`,
            },
        });
        // Simple rate limiting interceptor
        this.client.interceptors.request.use(async (config) => {
            await this.waitForRateLimit();
            return config;
        });
    }
    /**
     * Ensures we respect the rate limit by waiting if necessary
     */
    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            const waitTime = this.rateLimitDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastRequestTime = Date.now();
    }
    /**
     * Generic GET request with intelligent caching
     */
    async get(url, config) {
        const cacheKey = `GET:${url}:${JSON.stringify(config?.params || {})}`;
        if (cacheService.has(cacheKey)) {
            return cacheService.get(cacheKey);
        }
        const response = await this.client.get(url, config);
        cacheService.set(cacheKey, response.data);
        return response.data;
    }
    /**
     * Generic POST request
     */
    async post(url, data, config) {
        const response = await this.client.post(url, data, config);
        return response.data;
    }
    /**
     * Expose the underlying axios instance if needed for advanced usage
     */
    get instance() {
        return this.client;
    }
}
// Export a singleton instance
export const apiClient = new ApiClient();
