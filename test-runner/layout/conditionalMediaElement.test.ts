import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates, testCoordinatesAnyOrder, waitForCoordinates, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

test.describe('conditionalMediaElement.smil test', () => {
	const video1Coords = [
		[540, 960, 960, 540],
		[0, 0, 960, 540],
	];
	const video2Coords = [
		[540, 0, 960, 540],
		[540, 960, 960, 540],
	];

	/** Find the video-test-1 element positioned at top-left (x≈0, y≈0) */
	async function findVideo1AtTopLeft(page: any) {
		const locator = page.locator('video[src*="videos/video-test_465b7757.mp4"]');
		const count = await locator.count();
		for (let i = 0; i < count; i++) {
			const box = await locator.nth(i).boundingBox();
			if (box && box.x < 10) return locator.nth(i);
		}
		// Fallback to first if only one element
		return locator.first();
	}

	test('processes smil file correctly', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.conditionalMediaElement);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');
		monitor.watch(durationCandidates('conditionalMediaElement'));

		// Loader video (may be skipped if assets are cached from a previous test)
		await waitForLoaderOrSkip(page);

		// First set of elements visible
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]').first()).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });

		// Both video2 regions, matched by position (DOM order is nondeterministic)
		await testCoordinatesAnyOrder(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), video2Coords);
		// video1 may appear in multiple regions — find the one at top-left (x=0)
		const video1AtTL = await findVideo1AtTopLeft(page);
		await testCoordinates(video1AtTL, 0, 0, 960, 540);
		await testCoordinates(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]').first(), 0, 960, 960, 540);

		// Second state: landscape2 appears, video2 hides
		await expect(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="images/landscape2_2d654451.jpg"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]').first()).not.toBeVisible({ timeout: Timeouts.elementAwait });

		await testCoordinates(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]').first(), 0, 960, 960, 540);
		await testCoordinates(frame.locator('img[src*="images/landscape2_2d654451.jpg"]').first(), 540, 0, 960, 540);
		// Both video1 regions, matched by position (DOM order is nondeterministic)
		await testCoordinatesAnyOrder(page.locator('video[src*="videos/video-test_465b7757.mp4"]'), video1Coords);

		// Third state: landscape2 hides, video1 still visible
		await expect(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="images/landscape2_2d654451.jpg"]').first()).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });

		const video1AtTL3 = await findVideo1AtTopLeft(page);
		await testCoordinates(video1AtTL3, 0, 0, 960, 540);
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img4"]'), 0, 960, 960, 540);
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-bottom-left-img8"]'), 540, 0, 960, 540);
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-bottom-right-img12"]'), 540, 960, 960, 540);

		// Fourth state: video2 reappears
		await expect(frame.locator('img[src*="images/landscape1_fe944bd5.jpg"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(frame.locator('img[src*="images/landscape2_2d654451.jpg"]').first()).not.toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]').first()).toBeVisible({ timeout: Timeouts.elementAwait });

		await page.waitForTimeout(Timeouts.transition);
		// video2 regions re-appear out of phase here: bottom-left and bottom-right
		// loops have different cycle lengths, so 1 or 2 instances may be present at
		// this instant — assert whichever exist sit at distinct valid region boxes.
		await testCoordinatesAnyOrder(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), video2Coords, {
			subset: true,
		});
		// bottom-right must eventually RESUME video2 (its <seq repeatCount=
		// "indefinite"> is the only loop the player actually keeps running).
		// 30s ≈ one full region cycle (video2 + video1 + 3s img) with headroom.
		const video2 = page.locator('video[src*="videos/video-test_0b02adc4.mp4"]');
		await waitForCoordinates(video2, video2Coords[1], 30_000);
		// Bottom-left (video2Coords[0]) must also re-play video2. This used to
		// freeze: nested <par repeatCount="indefinite"> region wrappers that are
		// array-siblings were dispatched via createDefaultPromise, which silently
		// dropped their repeatCount=indefinite, so they played once and never
		// looped. Fixed in playlistTraverser.ts (loop-B now routes indefinite
		// child pars to createRepeatCountIndefinitePromise → own runEndlessLoop).
		await waitForCoordinates(video2, video2Coords[0], 30_000);
		const video1AtTL4 = await findVideo1AtTopLeft(page);
		await testCoordinates(video1AtTL4, 0, 0, 960, 540);
		await testCoordinates(frame.locator('img[id*="landscape1"][id*=".jpg-top-right-img4"]'), 0, 960, 960, 540);

		await monitor.assertDurationsWithinTolerance();
	});
});
