import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertHigherPriorityUninterrupted, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';

// Tests that lower="pause" does NOT pause the higher-priority element when a lower
// arrives. Without the fix in handlePriorityBeforePlay, handlePauseBehaviour acts on
// previousPlayingIndex (the higher element), pausing it and letting the lower take
// over. The fix remaps lower="pause" → defer in this branch.
//
// With the remap, P_high plays throughout its window. P_low defers (waits in
// handleDeferBehaviour) and plays cleanly after P_high's wallclock ends.
test.describe('priorityLowerPause.smil test', () => {
	test('lower="pause" does not pause higher-priority content', async ({ page, context, smilUrls, monitor }) => {
		await context.addInitScript((url: string) => {
			(window as unknown as { __SMIL_URL__?: string }).__SMIL_URL__ = url;
		}, smilUrls.priorityLowerPause);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		// Loader may be skipped if files are cached from a previous run
		await waitForLoaderOrSkip(page);

		monitor.watch(durationCandidates('priorityLowerPause'));

		// P_high (lower="pause", highest priority) plays then keeps looping — confirms it
		// was NOT paused. Partway through, P_low content must NOT be visible yet:
		// lower="pause" was remapped to defer, so P_low waits until P_high's window ends.
		await assertHigherPriorityUninterrupted(
			page,
			frame,
			'videos/video-test_465b7757.mp4',
			'images/img_1_aba14e1e.jpg',
			() => expect(frame.locator('img[src*="images/img_2_18b5d21f.jpg"]')).not.toBeVisible({ timeout: 3000 }),
		);

		// P_high wallclock ends at +90s → P_low released from defer. Prove P_low
		// actually CYCLES (img_2 → video-test-2 → img_2): img_2 DOM-hides while the
		// page-layer video plays (its ~3s monitor cycle proves this), so the
		// reappearance is a genuine loop-back, not a stale frame. A release-then-
		// deadlock — frozen on img_2 (video never appears) or on video-test-2 (img_2
		// never returns) — turns this RED instead of passing on one frozen element.
		const pLowImg2 = frame.locator('img:visible[src*="images/img_2_18b5d21f.jpg"]');
		await expect(pLowImg2, 'P_low img_2 plays after release').toBeVisible({ timeout: Timeouts.priorityWideWindowRelease });
		await expect(page.locator('video[src*="videos/video-test_0b02adc4.mp4"]'), 'P_low advances to video-test-2').toBeVisible({ timeout: Timeouts.elementAwait });
		await expect(pLowImg2, 'P_low loops back to img_2 (forward progress past first appearance)').toBeVisible({ timeout: Timeouts.elementAwait });

		await monitor.assertDurationsWithinTolerance();
	});
});
