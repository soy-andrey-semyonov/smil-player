import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Error RECOVERY / self-heal: every other error test asserts only the broken
// state (skip / backup) and never flips back to valid, so nothing proves the
// player resumes real content once the fault clears. These tests flip a fault
// broken -> valid and assert recovery.
//
// Scope note: broken-XML-SMIL recovery is intentionally NOT covered — on this
// branch the self-delete fix temp-routes a broken SMIL refresh so it never
// overwrites the cached file, so processSmilXml never throws and that recovery
// path is unreachable from e2e (see fallbackToPreviousPlaylist.test.ts / the
// remediation plan B3 note). The recoverable families are dead media and a
// 404 SMIL.

test.describe('errorRecovery — dead media self-heal', () => {
	test('a skipped (404) element recovers and resumes playing once its source returns 200', async ({
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
		}, smilUrls.skipContentOnHttpStatus); // skipContentOnHttpStatus="404", landscape1 + landscape2
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Phase 1: both images cycle normally.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Phase 2 (break): landscape1's update check returns 404 → marked skipContent.
		await request.post(`${testServerBaseUrl}/status-config`, { data: { fileName: 'landscape1.jpg', statusCode: 404 } });
		await waitForConsolePattern(collector, 'skipping content (status=', 1, 15000);
		await page.waitForTimeout(15000);

		// Confirm it is actually skipped (gone across several cycles).
		let brokenSeen = 0;
		for (let i = 0; i < 8; i++) {
			if (await frame.locator('img[src*="landscape1"]').isVisible().catch(() => false)) brokenSeen++;
			await page.waitForTimeout(1500);
		}
		expect(brokenSeen, 'landscape1 must be skipped while its source returns 404').toBe(0);

		// Phase 3 (heal): the source returns 200 again. The fetch strategy clears
		// media.expr before every HEAD, so the next ResourceChecker cycle (5s) sees
		// a 200, leaves expr cleared, and the element plays again.
		await request.post(`${testServerBaseUrl}/status-config`, { data: { fileName: 'landscape1.jpg', statusCode: 200 } });

		// Recovery: landscape1 reappears and keeps cycling; landscape2 never stalled.
		await expect(
			frame.locator('img[src*="landscape1"]'),
			'landscape1 must recover once its source returns 200',
		).toBeVisible({ timeout: 20000 });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});

test.describe('errorRecovery — 404 SMIL self-heal', () => {
	// The SMIL URL 404s at startup (recoverConfig defaults broken), so the player
	// plays the backup image. Once the URL is flipped valid, the player's download
	// retry loop (main(): playBackupImage -> sleep defaultDownloadRetry=60s -> retry)
	// re-fetches it, parses it, and resumes real content. Recovery latency is the
	// 60s retry, so the test budget is generous.
	test('a 404 SMIL recovers to real content once the URL serves valid SMIL', async ({
		page,
		context,
		request,
		testServerBaseUrl,
	}) => {
		test.setTimeout(150000);
		const collector = createConsoleCollector(page);
		// fallbackToPrevious.smil is a plain valid landscape1/landscape2 cycler — reused
		// here purely as the "recovered" payload served by the /recover-smil route.
		const smilUrl = `${testServerBaseUrl}/recover-smil/fallbackToPrevious.smil`;
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrl);
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Phase 1 (broken): the SMIL 404s → backup image plays.
		await waitForConsolePattern(collector, '[smil] SMIL download error', 1, Timeouts.firstElement);
		expect(
			collector.matching('[smil] playing backup image').length,
			'expected the backup image to play while the SMIL 404s',
		).toBeGreaterThan(0);
		await expect(frame.locator('img[id*=".jpg-rootLayout-img"]')).toBeVisible({ timeout: Timeouts.firstElement });
		// Real content must NOT be showing yet.
		expect(await frame.locator('img[src*="landscape1"]').isVisible().catch(() => false)).toBe(false);

		// Phase 2 (heal): the URL starts serving valid SMIL.
		await request.post(`${testServerBaseUrl}/recover-config`, {
			data: { fileName: 'fallbackToPrevious.smil', broken: false },
		});

		// Phase 3 (recovery): the retry loop re-fetches the now-valid SMIL and real
		// content takes over from the backup image (within the ~60s retry window).
		await expect(
			frame.locator('img[src*="landscape1"]'),
			'real content must take over once the SMIL serves valid again',
		).toBeVisible({ timeout: 90000 });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});
