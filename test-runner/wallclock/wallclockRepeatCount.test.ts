import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

test.describe('wallclockRepeatCount.smil test', () => {
	test('repeated content plays exactly twice then terminates to the sentinel', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.wallclockRepeatCount);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');
		monitor.watch(durationCandidates('wallclockRepeatCount'));

		// Loader may be skipped entirely with a warm asset cache
		await waitForLoaderOrSkip(page);

		const landscape1 = frame.locator('img:visible[src*="images/landscape1_fe944bd5.jpg"]');
		const landscape2 = frame.locator('img:visible[src*="images/landscape2_2d654451.jpg"]');

		// Initial state: two videos in parallel regions + the repeated image, correctly positioned.
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(landscape1).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="videos/video-test_465b7757.mp4"]'), 0, 0, 960, 540);
		await testCoordinates(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), 540, 960, 960, 540);
		await testCoordinates(landscape1, 0, 960, 960, 540);

		// repeatCount terminates: after exactly 2 iterations of landscape1 (dur=3s each) the
		// top-right playlist ADVANCES to the landscape2 sentinel. The original fixture had an
		// inner <seq repeatCount="indefinite"> that looped landscape1 forever, so the outer
		// repeatCount="2" was a no-op and the sentinel could never appear — this is the
		// termination guard for that bug class.
		await expect(landscape2).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(landscape2, 0, 960, 960, 540);
		await expect(landscape1).toHaveCount(0); // clean handoff — landscape1 no longer visible

		// Exact count: landscape1's single closed cycle is enforced at expectedSec=6 (= 2 × 3s)
		// via durationOverrides. A wrong repeatCount (e.g. 3 → ~9s) lands outside tolerance and
		// fails here — the count is no longer a no-op.
		await monitor.assertDurationsWithinTolerance();
	});
});
