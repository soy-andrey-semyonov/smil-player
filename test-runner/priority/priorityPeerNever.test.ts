import { test, expect } from '../fixtures';
import { DUID, Timeouts } from '../config';
import { assertVideoAdvancing, waitForLoaderOrSkip } from '../helpers';

test.describe('priorityPeerNever.smil test', () => {
	// peer="never" is the only-untested route into handleNeverBehaviour via the PEER
	// conflict branch (lower="never" is covered by priorityNever; the seq campaigns in
	// prioritySeqCampaign never run two peers concurrently so its peer="never" default
	// is inert). Here two peers share one region: Peer A (video-test-1 + img_1) begins
	// at 0; Peer B (img_3 + img_2) begins at +30s while A is still playing. With
	// peer="never" Peer B must be BLOCKED — it never interrupts A and never appears
	// during A's window. The discriminating contrast is priorityPeerStop, where the
	// second peer instead STOPS the first at its begin.
	test('peer="never" blocks the second peer; the first keeps looping uninterrupted', async ({ page, context, smilUrls }) => {
		await context.addInitScript((url: string) => {
			(window as any).__SMIL_URL__ = url;
		}, smilUrls.priorityPeerNever);

		await page.goto(`/?duid=${DUID}`);
		const frame = page.frameLocator('iframe');

		await waitForLoaderOrSkip(page);

		const peerAVideo = 'videos/video-test_465b7757.mp4';
		const peerAImg = 'images/img_1_aba14e1e.jpg';
		// Either of Peer B's two images appearing means B took over the region.
		const peerBContent =
			'img:visible[src*="images/img_3_4ac1868a.jpg"], img:visible[src*="images/img_2_18b5d21f.jpg"]';

		// Peer A starts first and shows its video then img_1.
		await expect(page.locator(`video[src*="${peerAVideo}"]`)).toBeVisible({ timeout: Timeouts.firstElement });
		await expect(frame.locator(`img:visible[src*="${peerAImg}"]`)).toBeVisible({ timeout: Timeouts.elementAwait });

		// Advance well past Peer B's begin (+30s) while still inside Peer A's window (ends +120s).
		await page.waitForTimeout(30000);

		// Peer B must still be blocked: peer="never" prevents it from ever starting
		// while Peer A holds the region, so none of its content is on screen. A
		// peer="stop" regression would have let Peer B take the region at +30s.
		await expect(frame.locator(peerBContent), 'Peer B must stay blocked under peer="never"').toHaveCount(0);

		// Peer A must still be actively looping (not frozen, not stopped): its video
		// returns and advances, then img_1 cycles back. Under a peer="stop" regression
		// Peer A would have been stopped at +30s, so neither of these would hold.
		await expect(page.locator(`video[src*="${peerAVideo}"]`)).toBeVisible({ timeout: Timeouts.priorityTransition });
		await assertVideoAdvancing(page, peerAVideo);
		await expect(
			frame.locator(`img:visible[src*="${peerAImg}"]`),
			'Peer A keeps looping past Peer B begin',
		).toBeVisible({ timeout: Timeouts.elementAwait });

		// Final snapshot: Peer B still blocked after a further Peer A cycle.
		await expect(frame.locator(peerBContent)).toHaveCount(0);
	});
});
