import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Tests that media is force-re-downloaded when its updateCheckUrl HEAD response
// returns a status code matching updateContentOnHttpStatus in the SMIL meta.
// This is the counterpart to skipContentOnHttpStatus: instead of disabling the
// element, a matching code forces a fresh download regardless of Last-Modified.
//
// Flow:
// 1. Both images cycle normally (status-check returns 200 → no forced update)
// 2. Configure server to return 226 for landscape1.jpg HEAD checks
// 3. ResourceChecker fires (contentRefresh=5s): the HEAD status matches
//    updateContentOnHttpStatus → fetchingStrategies logs
//    "forcing update (status=226 matched update codes)" and onUpdateContent
//    returns a future Last-Modified, which differs from the stored value →
//    shouldUpdateLocalFile re-downloads media.src.
// 4. Observable proof: a NEW GET of /assets/landscape1.jpg fires (the on-screen
//    <img> is served from local storage, so /assets GETs are downloads only),
//    while landscape2 (still 200, unchanged Last-Modified) does NOT re-download.
const UPDATE_CODE = 226;

test.describe('updateContentOnHttpStatus.smil test', () => {
	test('forces a re-download when HEAD status matches updateContentOnHttpStatus', async ({
		page,
		context,
		request,
		smilUrls,
		testServerBaseUrl,
	}) => {
		const collector = createConsoleCollector(page);

		// Count server-side downloads per asset. The displayed <img> is served from
		// local storage (a local path), so the only GETs that hit /assets/<name> are
		// the player's downloads — exactly what a forced update should trigger.
		const getCounts = { landscape1: 0, landscape2: 0 };
		page.on('request', (req) => {
			if (req.method() !== 'GET') {
				return;
			}
			const url = req.url();
			if (url.includes('/assets/landscape1.jpg')) {
				getCounts.landscape1++;
			} else if (url.includes('/assets/landscape2.jpg')) {
				getCounts.landscape2++;
			}
		});

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.updateContentOnHttpStatus);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Phase 1: both images cycle (each downloaded once on first pass).
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[src*="landscape2"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// Settle, then snapshot the baseline download counts.
		await page.waitForTimeout(2000);
		const baseLandscape1 = getCounts.landscape1;
		const baseLandscape2 = getCounts.landscape2;

		// Phase 2: configure landscape1's updateCheckUrl to return the update code.
		await request.post(`${testServerBaseUrl}/status-config`, {
			data: { fileName: 'landscape1.jpg', statusCode: UPDATE_CODE },
		});

		// Sentinel: the files module logs that the forced-update branch fired. The
		// debug library emits the raw printf template to the browser console (the
		// "%d" status placeholder is substituted by the console at display time, not
		// in the captured text), so match up to "status=" — exactly as the sibling
		// skipContentOnHttpStatus test matches "skipping content (status=".
		await waitForConsolePattern(collector, 'forcing update (status=', 1, 15000);

		// Allow a couple of ResourceChecker cycles (contentRefresh=5s) to re-download.
		await page.waitForTimeout(12000);

		// Phase 3: landscape1 was force-re-downloaded; landscape2 (200, unchanged
		// Last-Modified) was not — proving the update is targeted, not a general reload.
		expect(getCounts.landscape1).toBeGreaterThan(baseLandscape1);
		expect(getCounts.landscape2).toBe(baseLandscape2);

		// A forced update must NOT disable the element (unlike skipContentOnHttpStatus) —
		// it keeps cycling normally.
		await expect(frame.locator('img[src*="landscape1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
	});
});
