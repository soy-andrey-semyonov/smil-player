import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Tests the configurable backup image: sos.config.backupImageUrl.
//
// When a SMIL fails to download/parse (and fallbackToPreviousPlaylist is off),
// the player plays a backup image. The sibling brokenXml.test.ts covers the
// BUNDLED backup image (no backupImageUrl configured). This test covers the
// CONFIGURED branch: when sos.config.backupImageUrl is set, downloadBackupImage()
// fetches that image at startup and playBackupImage() displays it instead of the
// bundled asset.
//
// Trigger: the brokenXml.smil fixture (malformed XML -> parse error -> backup
// path). backupImageUrl points at landscape1.jpg, which brokenXml.smil does NOT
// reference, so a visible landscape1 image proves the CONFIGURED backup played
// (the bundled fallback would be backupImage_landscape.jpg instead).
test.describe('backupImageUrl config test', () => {
	test('plays the configured backupImageUrl image when the SMIL is invalid', async ({
		page,
		context,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);

		// Count downloads of the configured backup image (served from the test
		// server, so a GET to /assets/landscape1.jpg is the player fetching it).
		let backupDownloads = 0;
		page.on('request', (req) => {
			if (req.method() === 'GET' && req.url().includes('/assets/landscape1.jpg')) {
				backupDownloads++;
			}
		});

		const backupUrl = `${testServerBaseUrl}/assets/landscape1.jpg`;
		await context.addInitScript(
			(cfg: { url: string; backupUrl: string }) => {
				(window as any).__SMIL_URL__ = cfg.url;
				(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true', backupImageUrl: cfg.backupUrl };
			},
			{ url: smilUrls.brokenXml, backupUrl },
		);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// The configured backup image is downloaded at startup and displayed.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		expect(backupDownloads, 'configured backup image should have been downloaded').toBeGreaterThan(0);

		// Sentinels: the parse error fired and the backup path was taken.
		await waitForConsolePattern(collector, '[smil] XML parse error', 1, Timeouts.firstElement);
		expect(
			collector.matching('[smil] playing backup image').length,
			'expected at least one "[smil] playing backup image" log',
		).toBeGreaterThan(0);

		// It keeps showing the configured backup image (the SMIL never becomes valid).
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});
