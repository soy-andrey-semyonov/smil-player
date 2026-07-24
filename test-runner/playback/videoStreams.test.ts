import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertVideoAdvancing, testCoordinates, waitForLoaderOrSkip } from '../helpers';

test.describe('videoStreams.smil test', () => {
	// The stream item uses a locally-served mp4 (test-server /assets/video-test-1.mp4,
	// isStream="true") instead of the previously-dead external URL
	// https://www.rmp-streaming.com/media/bbb-360p.mp4 (SSL cert mismatch + 404). As a
	// stream the player points the <video src> straight at the (port-rewritten) URL rather
	// than downloading it to a checksum filename, so we match on the asset basename.
	test('processes smil file correctly', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.videoStreams);
		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Loader video visible (optional — may be cached)
		await waitForLoaderOrSkip(page);

		// Loader hides, landscape image visible in top-right
		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img1"]')).toBeVisible({ timeout: Timeouts.firstElement });
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img1"]'), 0, 960, 960, 540);

		// Landscape image hides, local video visible in top-right
		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img1"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), 0, 960, 960, 540);

		// Local video hides, stream video visible in top-right
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		const streamVideo = page.locator('video[src*="assets/video-test-1.mp4"]');
		await expect(streamVideo).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(streamVideo, 0, 960, 960, 540);

		// Prove the isStream code path ran rather than the ordinary download path:
		// for a stream the player points <video src> straight at the raw URL
		// (elementUrl = video.src), whereas a downloaded video is fetched to a
		// checksum filename under videos/<checksum>.mp4 (the previous slot). See
		// playlistCommon.ts:243. So the stream src must be the raw asset URL with
		// no videos/ checksum segment.
		const streamSrc = await streamVideo.getAttribute('src');
		expect(streamSrc, `stream src should be the raw URL, got: ${streamSrc}`).not.toContain('/videos/');
		expect(streamSrc).toContain('/assets/video-test-1.mp4');

		// Liveness: a frozen stream would still satisfy the visibility locator
		// above (every .mp4 candidate is expectedSec:0, so the visibility monitor
		// cannot catch a stuck video), so require currentTime to actually advance.
		await assertVideoAdvancing(page, 'assets/video-test-1.mp4');

		// Stream video hides, landscape image loops back
		await expect(page.locator('video[src*="assets/video-test-1.mp4"]')).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img1"]')).toBeVisible({ timeout: Timeouts.elementAwait });
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img1"]'), 0, 960, 960, 540);
	});
});
