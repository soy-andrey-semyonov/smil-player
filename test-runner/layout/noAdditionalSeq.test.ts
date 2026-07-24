import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates } from '../helpers';

// Layout fixture: 1920x1080 root-layout, four 50% regions.
// <par> with 4 simultaneous video-test-2 instances — one per region:
//   bottom-left  (left=0,   top=540, w=960, h=540)
//   bottom-right (left=960, top=540, w=960, h=540)
//   top-left     (left=0,   top=0,   w=960, h=540)
//   top-right    (left=960, top=0,   w=960, h=540)
test.describe('noAdditionalSeq.smil test', () => {
	test('processes smil file correctly', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.noAdditionalSeq);

		await page.goto(`/?duid=${DUID}`);

		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toBeVisible({ timeout: Timeouts.firstElement });

		// Exact per-hash count: exactly 4 instances (one per region).
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toHaveCount(4);

		// All 4 play simultaneously in a <par> — every one should be visible.
		const videos = page.locator('video[src*="videos/video-test_0b02adc4.mp4"]');
		for (let i = 0; i < 4; i++) {
			await expect(videos.nth(i)).toBeVisible({ timeout: Timeouts.elementAwait });
		}

		// Verify each video sits in its expected 50%-quadrant region box.
		// Playwright sorts DOM elements in document order; the SMIL order is
		// bottom-left, bottom-right, top-left, top-right.
		const expected = [
			{ top: 540, left: 0,   width: 960, height: 540 }, // bottom-left
			{ top: 540, left: 960, width: 960, height: 540 }, // bottom-right
			{ top: 0,   left: 0,   width: 960, height: 540 }, // top-left
			{ top: 0,   left: 960, width: 960, height: 540 }, // top-right
		];
		for (let i = 0; i < 4; i++) {
			const { top, left, width, height } = expected[i];
			await testCoordinates(videos.nth(i), top, left, width, height);
		}
	});
});
