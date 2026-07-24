import type { Page, FrameLocator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertVideoAdvancing, waitForLoaderOrSkip } from '../helpers';
import { durationCandidates } from '../duration/durationCandidates';
import { VisibilityMonitor } from '../visibilityMonitor';

/**
 * Peer-interruption modes share one priorityClass skeleton (Peer A plays first,
 * Peer B begins later) and differ only in the `peer="..."` attribute. The three
 * fixtures and their wallclock windows are distinct (server-substituted in
 * localServerTools.ts), so each mode keeps its own fixture + final assertion;
 * only the boilerplate (URL injection, loader skip, first-element checks) is shared.
 */
const VIDEO_A = 'videos/video-test_465b7757.mp4';
const IMG_1 = 'images/img_1_aba14e1e.jpg';
const IMG_2 = 'images/img_2_18b5d21f.jpg';
const IMG_3 = 'images/img_3_4ac1868a.jpg';

type PeerMode = {
	fixture: 'priorityPeerStop' | 'priorityPeerDefer' | 'priorityPeerPause';
	title: string;
	assert: (page: Page, frame: FrameLocator, monitor: VisibilityMonitor) => Promise<void>;
};

const MODES: PeerMode[] = [
	{
		fixture: 'priorityPeerStop',
		title: 'peer="stop": stopped peer recovers via handlePrecedingContentStop when stopper finishes',
		assert: async (page, frame, monitor) => {
			// Peer B (img_3) starts at +30s and stops Peer A (peer="stop").
			await expect(frame.locator(`img[src*="${IMG_3}"]`)).toBeVisible({ timeout: Timeouts.priorityTransition });

			// Peer B's window ends at +60s → Peer A recovers via handlePrecedingContentStop.
			// Prove the recovery is REAL, not a frozen last frame: the video reappears AND is
			// actively advancing, then Peer A's seq resumes cycling to img_1. The old test
			// inferred recovery from the video element merely reappearing — but that .mp4
			// candidate is expectedSec:0 (monitor-blind), so a frozen-on-last-frame video passed.
			await expect(page.locator(`video[src*="${VIDEO_A}"]`)).toBeVisible({ timeout: Timeouts.priorityTransition });
			await assertVideoAdvancing(page, VIDEO_A);
			await expect(frame.locator(`img:visible[src*="${IMG_1}"]`), 'Peer A seq resumes cycling to img_1').toBeVisible({ timeout: Timeouts.elementAwait });

			await monitor.assertDurationsWithinTolerance();
		},
	},
	{
		fixture: 'priorityPeerDefer',
		title: 'peer="defer": second peer defers until first peer wallclock ends',
		assert: async (_page, frame, monitor) => {
			await expect(frame.locator(`img[src*="${IMG_3}"]`)).not.toBeVisible({ timeout: 3000 });

			await expect(frame.locator(`img[src*="${IMG_3}"]`)).toBeVisible({ timeout: Timeouts.priorityTransition });
			await expect(frame.locator(`img[src*="${IMG_2}"]`)).toBeVisible({ timeout: Timeouts.elementAwait });

			await monitor.assertDurationsWithinTolerance();
		},
	},
	{
		fixture: 'priorityPeerPause',
		title: 'peer="pause": second peer pauses first peer, first resumes after second ends',
		assert: async (page, frame, monitor) => {
			await expect(frame.locator(`img[src*="${IMG_3}"]`)).toBeVisible({ timeout: Timeouts.priorityTransition });

			await expect(page.locator(`video[src*="${VIDEO_A}"]`)).toBeVisible({ timeout: Timeouts.priorityTransition });

			await monitor.assertDurationsWithinTolerance({ toleranceMs: 800 });
		},
	},
];

test.describe('priorityPeer interruption modes (stop/defer/pause)', () => {
	for (const mode of MODES) {
		test(mode.title, async ({ page, context, smilUrls, monitor }) => {
			await context.addInitScript((url: string) => {
				(window as unknown as { __SMIL_URL__?: string }).__SMIL_URL__ = url;
			}, smilUrls[mode.fixture]);

			await page.goto(`/?duid=${DUID}`);
			const frame = page.frameLocator('iframe');

			await waitForLoaderOrSkip(page);

			monitor.watch(durationCandidates(mode.fixture));

			await expect(page.locator(`video[src*="${VIDEO_A}"]`)).toBeVisible({ timeout: Timeouts.firstElement });
			await expect(frame.locator(`img:visible[src*="${IMG_1}"]`)).toBeVisible({ timeout: Timeouts.elementAwait });

			await mode.assert(page, frame, monitor);
		});
	}
});
