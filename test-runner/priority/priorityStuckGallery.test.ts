import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

// Regression test for the production "stuck on last gallery element" freeze.
//
// Root cause pair (both fixed together):
// 1. generateParentId hashed the live parsed tree; playing the gallery <img>
//    wrote `wasUpdated` onto it (handleHtmlElementPrepare), so on cycle 2 the
//    gallery seq hashed to a different parent ID. Cycle 2's first video then
//    registered as a NEW entry and hit a phantom peer conflict (default
//    peer=never) against cycle 1's still-"playing" last video.
// 2. registerOrUpdate's parent-match branch dropped timesPlayed on every seq
//    advance, so the last element always evaluated repeatCountExpired=false
//    and markFinished never released the slot the never-waiter watched.
//
// Pre-fix the playlist deterministically froze after one gallery cycle.
// The assertion that matters is video-test-1 reappearing for cycle 2.
test.describe('priorityStuckGallery.smil test', () => {
	test('video-img-video gallery keeps cycling past the first iteration', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.priorityStuckGallery);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await waitForLoaderOrSkip(page);

		monitor.watch(durationCandidates('priorityStuckGallery'));

		// Three full gallery cycles: video-test-1 → img_1 → video-test-2, repeating.
		// The cycle 1→2 boundary is where the pre-fix deadlock fired (the parent
		// hash drifts exactly once, between the pristine first pass and the
		// mutated second pass); cycle 3 proves steady-state looping beyond it.
		// Each assertion can only match a NEW appearance: the video src is
		// nulled when playback ends, and img_1 is hidden while videos play.
		for (let cycle = 1; cycle <= 3; cycle++) {
			await expect(page.locator('video[src*="videos/video-test_465b7757.mp4"]'),
				`cycle ${cycle}: video-test-1`).toBeVisible({ timeout: cycle === 1 ? Timeouts.firstElement : Timeouts.elementAwait });
			await expect(frame.locator('img:visible[src*="images/img_1_aba14e1e.jpg"]'),
				`cycle ${cycle}: img_1`).toBeVisible({ timeout: Timeouts.elementAwait });
			await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'),
				`cycle ${cycle}: video-test-2`).toBeVisible({ timeout: Timeouts.elementAwait });
		}

		await monitor.assertDurationsWithinTolerance();
	});
});
