import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { testCoordinates, waitForLoaderOrSkip, assertVideoAdvancing } from '../helpers';

// ============================================================================
// Wallclock `end` is a latest-START guard, NOT a mid-play cutoff.
//
// The fixture puts a wallclock window [now-10s, now+25s] on a <par> whose child
// is a single long (~35s) in-flight element: <seq repeatCount="8"> looping
// video-test-1 (4.37s). `end` (~25s after the SMIL is fetched) therefore passes
// while that element is mid-play. A correct player uses `end` only to gate the
// START of new iterations, so the element already running must keep playing —
// it must NOT be cut off at `end`. A regression that turned `end` into a
// mid-play cutoff would freeze/stop the video at ~25s.
//
// SCOPE: this is the genuinely novel coverage — the "in-flight element not cut
// off" boundary. The other half ("expired -> never starts" / no NEW iteration
// begins after `end`) is already covered by noActivePar/noActiveSeq + the
// playlistWallclock units, and is hard to assert directly here because the
// player FREEZES the last frame when a region's playlist ends (so "the element
// disappears after end" is unobservable). See the remediation plan B11 note.
// ============================================================================
test.describe('wallclockEndBoundary.smil test', () => {
	test('an element already playing when wallclock `end` passes keeps playing (not cut off)', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.wallclockEndBoundary);
		await page.goto(`/?duid=${DUID}`);
		const video = page.locator('video[src*="video-test_465b7757"]');

		// Loader during prefetch — may be skipped entirely with a warm asset cache
		await waitForLoaderOrSkip(page);

		// The windowed video starts inside the window and plays full screen.
		await expect(video).toBeVisible({ timeout: Timeouts.firstElement });
		const visibleAt = Date.now();
		await testCoordinates(video, 0, 0, 1920, 1080);
		await assertVideoAdvancing(page, 'video-test_465b7757');

		// Wait until we are safely PAST `end`. `end` is at most 25s after the SMIL is
		// fetched, and the video first becomes visible only after the fetch, so `end` is
		// at most 25s after `visibleAt` — anchoring the wait to `visibleAt` keeps this
		// robust against cold-compile / slow-download timing. 28s is past `end` yet still
		// inside the ~35s in-flight element.
		const PAST_END_MS = 28_000;
		const elapsed = Date.now() - visibleAt;
		if (elapsed < PAST_END_MS) {
			await page.waitForTimeout(PAST_END_MS - elapsed);
		}

		// The in-flight element must STILL be playing past `end` — proof that `end`
		// gated only new starts and did not cut the running element off.
		await expect(video, 'windowed video must remain visible past wallclock end').toBeVisible();
		await assertVideoAdvancing(page, 'video-test_465b7757');
	});
});
