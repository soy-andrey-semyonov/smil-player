import { expect } from '@playwright/test';
import { test } from '../fixtures';
import { createSyncGroup, cleanupSyncGroup, uniqueGroupName, SyncDevice } from '../syncHelpers';
import { waitForMasterElection, waitForConvergence } from './syncAssertions';

// Regression test for the future-begin priority takeover bug (customer
// GalleryModule playlist, docs/superpowers/bugs/playlist.smil):
//
// A higher priorityClass holds a single campaign `seq repeatCount="1"` whose
// non-repeating wallclock window opens DURING playback; the lower class
// (higher="pause" pauseDisplay="hide") rotates a gallery. With 2 synced
// devices this used to fail in two escalating ways:
//
// 1. Pre-hold (flicker): every ~20s campaign pass ended with
//    `repeatCountExpired+isLast` → markFinished → unpauseControlled(lower),
//    releasing the paused lower class mid-window. The lower raced the
//    campaign's replay and repeatedly reached sos.video.play (lower content
//    flickering over the campaign) while the erratic cadence starved the
//    slave's sync waits (15–24s black stalls).
//
// 2. Hold-only (field regression of the first fix): holding the unpause
//    between passes exposed two pre-existing bugs the per-pass churn had been
//    masking: (a) `controlledPlaylist` was a single pointer while multiple
//    lower sibling playlists get paused during one window — at close only the
//    LAST victim was released and the rest froze at the pause gate forever
//    (device stuck on a stale campaign frame = "devices out of sync");
//    (b) the pause gate sat downstream of sync coordination, so a held
//    playlist starved 60s cmd-prepare waits all window and corrupted the
//    region's resync state (wrapped resync targets pointing at unreachable
//    campaign elements).
//
// The fix: activeWindowEnd hold + multi-victim `controlledPlaylists` release
// + early pause gate ahead of sync coordination. Assertions below are
// console-log based (playElement logs are ground truth — DOM sampling proved
// blind to lower-class videos) and target each failure mode directly.
// Window offsets: +60s open, +180s close from first SMIL fetch (see the
// priorityFutureGallery fillWallclock case).

const LOW_SRC = /video-test-\d|img_1/;

/** Console messages of a device since test start. */
function messages(dev: SyncDevice) {
	return dev.console.messages;
}

function lowPlays(dev: SyncDevice, from: number, to: number): number {
	return messages(dev).filter(
		(m) =>
			m.time > from &&
			m.time < to &&
			m.text.includes('[processor] playing element:') &&
			LOW_SRC.test(m.text),
	).length;
}

test.describe.configure({ mode: 'serial' });
test.describe('future-begin priority campaign + 2-device sync', () => {
	let devices: SyncDevice[] = [];

	test.afterEach(async () => {
		await cleanupSyncGroup(devices);
		devices = [];
	});

	test('campaign window holds the region exclusively; both devices resume after close', async ({
		browser,
		testServerBaseUrl,
	}, testInfo) => {
		test.setTimeout(420_000);

		devices = await createSyncGroup(browser, {
			smilUrl: `${testServerBaseUrl}/dynamic/priorityFutureGallery.smil`,
			groupName: uniqueGroupName(testInfo.title),
			deviceCount: 2,
			consoleMaxMessages: 300_000,
		});

		await waitForMasterElection(devices, 60_000);

		// Lower gallery plays first (window still closed).
		await waitForConvergence(devices, (p) => p.locator('video[src*="video-test"]'), 90_000);

		// Window opens ≤+60s from first SMIL fetch: campaign video appears on both.
		await waitForConvergence(devices, (p) => p.locator('video[src*="landscape1"]'), 90_000);
		const tOpen = Date.now();

		// The 120s window closes ~tOpen+120s (tOpen lags the true open by the
		// handshake, so this is a slight overestimate — safe for the mid-window
		// bound below). Sample campaign liveness on the way.
		const closeBy = tOpen + 120_000;
		const lastHighSeen: number[] = devices.map(() => Date.now());
		const maxHighGap: number[] = devices.map(() => 0);
		while (Date.now() < closeBy - 10_000) {
			for (let i = 0; i < devices.length; i++) {
				const seen = await devices[i].page
					.evaluate(() =>
						Array.from(document.querySelectorAll('video')).some(
							(v) =>
								(v.src || '').match(/landscape1|loader/) !== null &&
								v.offsetWidth > 0 &&
								v.offsetHeight > 0,
						),
					)
					.catch(() => false);
				if (seen) {
					maxHighGap[i] = Math.max(maxHighGap[i], Date.now() - lastHighSeen[i]);
					lastHighSeen[i] = Date.now();
				}
			}
			await new Promise((r) => setTimeout(r, 500));
		}

		// Campaign content painted continuously mid-window (no dead air / stalls).
		for (let i = 0; i < devices.length; i++) {
			maxHighGap[i] = Math.max(maxHighGap[i], Date.now() - lastHighSeen[i]);
			expect(
				maxHighGap[i],
				`device ${i}: campaign content had a ${maxHighGap[i]}ms dead gap mid-window (stall)`,
			).toBeLessThan(8_000);
		}

		// FAILURE MODE 1 (flicker): mid-window there must be no cross-priority
		// unpause and no lower-class element may reach playback.
		const midFrom = tOpen + 5_000;
		const midTo = closeBy - 12_000;
		for (let i = 0; i < devices.length; i++) {
			const midWindowUnpauses = messages(devices[i]).filter(
				(m) =>
					(m.text.includes('unpaused controlled playlist') ||
						m.text.includes('unpauseAllControlled')) &&
					m.time > midFrom &&
					m.time < midTo,
			);
			expect(
				midWindowUnpauses.length,
				`device ${i}: cross-priority unpause fired mid-window (per-pass release bug)`,
			).toBe(0);
			expect(
				lowPlays(devices[i], midFrom, midTo),
				`device ${i}: lower-priority content reached playback mid-window (flicker)`,
			).toBe(0);
		}

		// FAILURE MODE 2b (sync-wait starvation): a held playlist must never sit
		// in a starving cmd wait — zero 60s sync timeouts for the whole test.
		for (let i = 0; i < devices.length; i++) {
			// NOTE: captured console text keeps debug-format placeholders (%s) with
			// args appended, so match on the literal tail of the format string.
			const starvedWaits = messages(devices[i]).filter((m) =>
				m.text.includes('triggering resync'),
			);
			expect(
				starvedWaits.length,
				`device ${i}: sync cmd wait starved into 60s timeout (pause gate downstream of sync coordination)`,
			).toBe(0);
		}

		// FAILURE MODE 2a (frozen victims): after the window closes, BOTH devices
		// must resume the lower gallery and keep advancing. A device frozen at the
		// pause gate (leaked victim) or at a stale resync target produces zero
		// lower playElement logs here.
		await waitForConvergence(devices, (p) => p.locator('video[src*="video-test"]'), 90_000);
		const resumeDeadline = closeBy + 75_000;
		await new Promise((r) => setTimeout(r, Math.max(0, resumeDeadline - Date.now())));
		for (let i = 0; i < devices.length; i++) {
			expect(
				lowPlays(devices[i], closeBy - 20_000, resumeDeadline),
				`device ${i}: lower gallery did not resume and advance after window close (frozen pause victim / stale resync)`,
			).toBeGreaterThanOrEqual(3);
		}
	});
});
