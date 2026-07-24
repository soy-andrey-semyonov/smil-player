import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { createConsoleCollector, waitForConsolePattern } from '../helpers';

// Tests the location-strategy content deduplication ("moved content, copy-only")
// in filesManager.parallelDownloadAllFiles.
//
// Setup: two <img> slots with DISTINCT src paths (/dedup/redirect/slot-one and
// /dedup/redirect/slot-two) that both 204+redirect (Location header) to the SAME
// content URL (/dedup/content/shared.jpg). Because getFileName checksums the src,
// the two slots get distinct on-disk filenames and distinct DOM ids — they are
// genuinely two playlist elements — but their resolved content is identical.
//
// Expected behaviour: the initial download batches both slots into one
// parallelDownloadAllFiles call; Phase 2 groups them by content URL (logs
// "DEDUP: Found 2 URLs pointing to same content"), Phase 3c downloads the
// primary ONCE and COPIES it for the duplicate ("DEDUP: Successfully copied
// file for ..."). The shared content is therefore fetched from the network
// exactly once even though two slots reference it.
//
// A regression that broke dedup (downloading each slot independently) would
// fetch the shared content twice and fail the GET-count assertion.
test.describe('movedContentDedup.smil test', () => {
	test('two slots resolving to one content download it once and copy for the duplicate', async ({
		page,
		context,
		smilUrls,
	}) => {
		const collector = createConsoleCollector(page);

		// Count network GETs the player makes for the shared content. Two slots
		// reference it; with copy-only dedup it is downloaded exactly once.
		const contentGets: string[] = [];
		page.on('request', (req) => {
			if (req.method() === 'GET' && req.url().includes('/dedup/content/shared.jpg')) {
				contentGets.push(req.url());
			}
		});

		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
			(window as any).__SYNC_CONFIG__ = { debugEnabled: 'true' };
		}, smilUrls.movedContentDedup);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Both slots render their (identical) image: slot-one's own download and
		// slot-two's copy are both valid, displayable files. The distinct DOM ids
		// prove these are two separate playlist elements, not one collapsed slot.
		await expect(frame.locator('img[id*="slot-one"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator('img[id*="slot-two"]')).toBeVisible({ timeout: Timeouts.elementAwait });

		// The dedup code path executed: it detected the duplicate content...
		await waitForConsolePattern(collector, 'URLs pointing to same content', 1, Timeouts.firstElement);
		// ...and satisfied the second slot by COPYING the primary download (not a 2nd GET).
		expect(
			collector.count('DEDUP: Successfully copied file for'),
			'expected the duplicate slot to be satisfied by a copy of the primary download',
		).toBeGreaterThan(0);

		// Authoritative proof: the shared content was fetched from the network EXACTLY
		// ONCE, even though two distinct slots reference it (copy-only dedup).
		expect(
			contentGets.length,
			`shared content should be downloaded exactly once (got ${contentGets.length} GETs)`,
		).toBe(1);
	});
});
