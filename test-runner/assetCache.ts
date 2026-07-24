import { BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getFileName } from '../src/components/files/tools/fileName';

/** Fixture-media CDN hosts. Their assets are immutable (versioned filenames),
 * so caching forever is safe. Deliberately NOT matched: localhost (emulator,
 * test servers — dynamic), statttttic.signageos.io (intentional broken-host
 * fixture), www.signageos.io (live website <ref> content). */
const CACHED_HOSTS = /^https:\/\/(demo|static)\.signageos\.io\//;

/** Gitignored, self-populating (write-through on first miss); safe to delete
 * any time — the next run rebuilds it from the CDN. */
export const CACHE_DIR = path.join(__dirname, '.asset-cache');

/** Cache key = the player's own checksummed filename for the URL, so cache
 * entries are deterministic and collision-free across paths/query strings.
 * The player appends a RANDOM `__smil_version` cache-buster to every download
 * URL (createVersionedUrl) but derives its stored filename from the bare src —
 * strip that one param the same way (cf. stripSmilVersion in filesManager.ts)
 * or every request is a unique key and the cache never hits. */
export function cachePathFor(url: string): string {
	let normalized = url;
	try {
		const urlObj = new URL(url);
		urlObj.searchParams.delete('__smil_version');
		normalized = urlObj.toString();
	} catch {
		// Unparseable URL — fall through with the raw string.
	}
	return path.join(CACHE_DIR, getFileName(normalized));
}

/** Only full GET 200s are cacheable. HEAD must stay live (the player's
 * Last-Modified update checks); non-200 must keep failing the same way
 * (notExistingMedia-style fixtures). */
export function shouldCache(method: string, status: number): boolean {
	return method === 'GET' && status === 200;
}

interface CacheMeta {
	contentType?: string;
}

/** Set ASSET_CACHE_DEBUG=1 to log every hit/miss/pass-through to stdout. */
function debugLog(kind: 'hit' | 'miss' | 'pass', url: string): void {
	if (process.env.ASSET_CACHE_DEBUG) {
		// eslint-disable-next-line no-console
		console.log(`[asset-cache] ${kind} ${url}`);
	}
}

/**
 * Write-through CDN asset cache for e2e tests. Every test runs in a fresh
 * BrowserContext (empty HTTP cache), so without this each test re-downloads
 * ~7MB of fixture media. Hit → served from disk; miss → fetched once from the
 * real CDN, persisted, then served. Install on the context BEFORE navigation.
 */
export async function installAssetCache(context: BrowserContext): Promise<void> {
	await fs.promises.mkdir(CACHE_DIR, { recursive: true });
	await context.route(CACHED_HOSTS, async (route) => {
		const request = route.request();
		if (request.method() !== 'GET') {
			debugLog('pass', `${request.method()} ${request.url()}`);
			return route.continue();
		}
		const bodyPath = cachePathFor(request.url());
		const metaPath = `${bodyPath}.meta.json`;
		// Meta is renamed into place AFTER the body (see below), so meta
		// present ⇒ body complete, even with concurrent workers.
		if (fs.existsSync(metaPath)) {
			debugLog('hit', request.url());
			const meta: CacheMeta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
			return route.fulfill({
				status: 200,
				contentType: meta.contentType,
				body: await fs.promises.readFile(bodyPath),
			});
		}
		debugLog('miss', request.url());
		let response;
		try {
			response = await route.fetch();
		} catch {
			// CDN unreachable — fail the request exactly as it would without
			// the cache; never half-populate the cache.
			return route.abort('failed');
		}
		if (shouldCache(request.method(), response.status())) {
			const body = await response.body();
			// Concurrent workers can miss the same asset simultaneously:
			// pid-unique tmp + atomic rename = last-write-wins of identical bytes.
			const tmpBody = `${bodyPath}.${process.pid}.tmp`;
			await fs.promises.writeFile(tmpBody, body);
			await fs.promises.rename(tmpBody, bodyPath);
			const meta: CacheMeta = { contentType: response.headers()['content-type'] };
			const tmpMeta = `${metaPath}.${process.pid}.tmp`;
			await fs.promises.writeFile(tmpMeta, JSON.stringify(meta));
			await fs.promises.rename(tmpMeta, metaPath);
			return route.fulfill({ response, body });
		}
		return route.fulfill({ response });
	});
}
