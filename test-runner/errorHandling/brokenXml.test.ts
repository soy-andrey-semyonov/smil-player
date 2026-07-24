import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, testCoordinates, waitForConsolePattern } from '../helpers';

test.describe('brokenXml.smil test', () => {
	test('processes smil file correctly', async ({ page, context, smilUrls }) => {
		// Enable debug output so sentinel console strings ([smil] ...) are emitted.
		// Pattern mirrors playModeOneFiniteRepeat.test.ts — inject debugEnabled via
		// __SYNC_CONFIG__ (smilPlayer.ts reads configOverrides.debugEnabled).
		const collector = createConsoleCollector(page);

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.brokenXml);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await expect(frame.locator('img[id*=".jpg-rootLayout-img"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await testCoordinates(frame.locator('img[id*=".jpg-rootLayout-img"]'), 0, 0, 1920, 1080);

		await page.waitForTimeout(Timeouts.videoTransition);

		await expect(frame.locator('img[id*=".jpg-rootLayout-img"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*=".jpg-rootLayout-img"]'), 0, 0, 1920, 1080);

		// Sentinel assertions: the player must have logged both the XML parse
		// error and the backup-image fallback.
		await waitForConsolePattern(collector, '[smil] XML parse error', 1, Timeouts.firstElement);
		expect(
			collector.matching('[smil] playing backup image').length,
			'expected at least one "[smil] playing backup image" log',
		).toBeGreaterThan(0);
	});
});
