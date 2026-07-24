import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertVideoAdvancing, testCoordinates, waitForLoaderOrSkip } from '../helpers';

// videoBackground.smil layers two elements in a single <par> on overlapping
// regions: a full-screen video (region "video" = left0/top0/1920x1080, plays on
// the main page) and a left-half background image (region "image" =
// left0/top0/960x1080, renders inside the applet iframe). This is the
// "video background" composition — an image composited over a continuously
// playing video. Both must be on screen at the same time, each in its own region.
test.describe('videoBackground.smil test', () => {
	test('video and background image render simultaneously in their regions', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.videoBackground);
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Loader video plays while the prefetch runs (optional — may be cached).
		await waitForLoaderOrSkip(page);

		// Full-screen video (page layer) plays in the "video" region. It has no
		// dur and loops via the indefinite <par>, so it is on screen continuously
		// — asserting it first establishes that the par has started.
		const bgVideo = page.locator('video[src*="videos/video-test_465b7757.mp4"]');
		await expect(bgVideo).toBeVisible({ timeout: Timeouts.firstElement });

		// Background image (frame layer) shows in the left-half "image" region.
		// It carries dur="3s" and cycles with the par, so check its geometry
		// immediately after it appears — while still inside its visible window —
		// to capture the simultaneous video + image composition.
		const bgImage = frame.locator('img[src*="landscape1"]');
		await expect(bgImage).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(bgImage, 0, 0, 960, 1080);

		// The video is still up (continuous) — verify its full-screen region box
		// AND that it is genuinely advancing, not frozen on a single composited
		// frame (the monitor cannot see this: the .mp4 candidate is expectedSec:0).
		await expect(bgVideo).toBeVisible();
		await assertVideoAdvancing(page, 'videos/video-test_465b7757.mp4');
		await testCoordinates(bgVideo, 0, 0, 1920, 1080);
	});
});
