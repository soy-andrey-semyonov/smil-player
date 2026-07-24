import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';

// Tests the per-media `updateCheckInterval` attribute, which sets how often the
// ResourceChecker re-issues an update HEAD for that resource
// (convertToResourceCheckerFormat: interval = updateCheckInterval * 1000, else
// the refresh-based default). Resources are grouped by interval and each group
// re-checks on its own setTimeout cadence.
//
// Observable: HEAD requests to a resource's updateCheckUrl (/status-check/<file>)
// come ONLY from the ResourceChecker — the initial download HEAD targets the src
// (/assets/<file>) instead — so counting /status-check HEADs isolates the
// interval-driven checks. A fast (2s) image accrues many more HEADs than a slow
// (15s) image over the same window.
test.describe('updateCheckInterval.smil test', () => {
	test('honors per-media updateCheckInterval for HEAD-check cadence', async ({ page, context, smilUrls }) => {
		const heads = { fast: 0, slow: 0 };
		page.on('request', (req) => {
			if (req.method() !== 'HEAD') {
				return;
			}
			const url = req.url();
			if (url.includes('/status-check/landscape1.jpg')) {
				heads.fast++;
			} else if (url.includes('/status-check/landscape2.jpg')) {
				heads.slow++;
			}
		});

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.updateCheckInterval);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Both images cycle; once visible the ResourceChecker is running.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Snapshot HEAD counts now, then measure the delta over a fixed window so
		// startup checks don't skew the per-interval comparison.
		const baseFast = heads.fast;
		const baseSlow = heads.slow;
		await page.waitForTimeout(14000);
		const deltaFast = heads.fast - baseFast;
		const deltaSlow = heads.slow - baseSlow;

		// The 2s image must re-check several times in a 14s window...
		expect(deltaFast, `fast (2s) image HEAD checks in 14s window (got ${deltaFast})`).toBeGreaterThanOrEqual(3);
		// ...and clearly more often than the 15s image.
		expect(
			deltaFast,
			`fast (2s) image should re-check more often than slow (15s) image (fast=${deltaFast}, slow=${deltaSlow})`,
		).toBeGreaterThan(deltaSlow);
	});
});
