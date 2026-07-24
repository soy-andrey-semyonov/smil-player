import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// HTTP-status branches of the update-check fetch strategy that were previously
// untested (fetchingStrategies.ts executeHeadRequest):
//   - 5xx server error (:97-107): allowLocalFallback!==false keeps the last-good
//     local copy (no update, element keeps playing); allowLocalFallback===false
//     marks the element skipContent.
//   - request timeout (:58-62): the HEAD aborts after fileCheckTimeout (2s) →
//     statusCode 408, always falls back to local (never skips).
//   - comma-separated skipContentOnHttpStatus (:109 .includes over the parsed
//     array): a code OTHER than the first in the list still triggers the skip.
// Only 404 (skip) and 226 (update) were covered before. All four cases drive the
// per-worker /status-check HEAD endpoint via /status-config.

test.describe('httpStatusFallback.smil test', () => {
	test('5xx keeps the last-good local copy when allowLocalFallback is not disabled', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.skipContentOnHttpStatus); // no allowLocalFallback attr → default (fallback allowed)
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Phase 1: both images cycle normally.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Phase 2: landscape1's update check starts returning 503.
		await request.post(`${testServerBaseUrl}/status-config`, { data: { fileName: 'landscape1.jpg', statusCode: 503 } });

		// Sentinel: the 5xx branch fired AND chose local fallback (not skip).
		await waitForConsolePattern(collector, 'server error: status=', 1, 15000);
		await waitForConsolePattern(collector, 'using local fallback', 1, 15000);
		expect(collector.count('skipping content (no local fallback)'), 'must NOT skip when fallback is allowed').toBe(0);

		// Phase 3: landscape1 keeps cycling — the 503 did not disable it.
		await page.waitForTimeout(8000);
		await expect(
			frame.locator('img[src*="landscape1"]'),
			'503 with fallback allowed must keep the element playing',
		).toBeVisible({ timeout: Timeouts.elementAwait });
	});

	test('5xx marks the element skipContent when allowLocalFallback="false"', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.http503NoFallback); // landscape1 has allowLocalFallback="false"
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		await request.post(`${testServerBaseUrl}/status-config`, { data: { fileName: 'landscape1.jpg', statusCode: 503 } });

		// Sentinel: the no-fallback branch marked the element skipContent.
		await waitForConsolePattern(collector, 'skipping content (no local fallback)', 1, 15000);
		await page.waitForTimeout(15000);

		// landscape1 is gone across multiple cycles; landscape2 still cycles.
		let seen = 0;
		for (let i = 0; i < 8; i++) {
			if (await frame.locator('img[src*="landscape1"]').isVisible().catch(() => false)) seen++;
			await page.waitForTimeout(1500);
		}
		expect(seen, 'landscape1 must be skipped (allowLocalFallback=false + 503)').toBe(0);
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});

	test('a HEAD timeout falls back to local (408) without disabling the element', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.skipContentOnHttpStatus); // default fallback; timeout ignores allowLocalFallback anyway
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Make landscape1's update-check HEAD hang past the 2s fileCheckTimeout.
		await request.post(`${testServerBaseUrl}/status-config`, {
			data: { fileName: 'landscape1.jpg', statusCode: 'timeout' },
		});

		// Sentinel: the client aborted the HEAD and took the timeout (408) branch.
		await waitForConsolePattern(collector, 'request aborted (timeout=', 1, 20000);

		// A timeout must NOT skip the element — it keeps playing the local copy.
		await page.waitForTimeout(8000);
		await expect(
			frame.locator('img[src*="landscape1"]'),
			'a timeout must keep the element playing from local',
		).toBeVisible({ timeout: Timeouts.elementAwait });
	});

	test('a comma-separated skipContentOnHttpStatus skips on a non-first code (410 in "404,410")', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.httpMultiSkip); // skipContentOnHttpStatus="404,410"
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// 410 is the SECOND entry in the list — a single-code "404" SMIL would NOT skip here.
		await request.post(`${testServerBaseUrl}/status-config`, { data: { fileName: 'landscape1.jpg', statusCode: 410 } });

		await waitForConsolePattern(collector, 'skipping content (status=', 1, 15000);
		await page.waitForTimeout(15000);

		let seen = 0;
		for (let i = 0; i < 8; i++) {
			if (await frame.locator('img[src*="landscape1"]').isVisible().catch(() => false)) seen++;
			await page.waitForTimeout(1500);
		}
		expect(seen, 'landscape1 must be skipped on 410 (second code in the comma list)').toBe(0);
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});
