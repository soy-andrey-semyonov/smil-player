import { expect, Frame, FrameLocator, Locator, Page } from '@playwright/test';
import { Timeouts } from './config';

const COORDINATE_TOLERANCE = 2; // ±2px tolerance for sub-pixel rendering differences

export async function testCoordinates(
	locator: Locator, top: number, left: number, width: number, height: number,
) {
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	expect(Math.abs(box!.x - left)).toBeLessThanOrEqual(COORDINATE_TOLERANCE);
	expect(Math.abs(box!.y - top)).toBeLessThanOrEqual(COORDINATE_TOLERANCE);
	expect(Math.abs(box!.width - width)).toBeLessThanOrEqual(COORDINATE_TOLERANCE);
	expect(Math.abs(box!.height - height)).toBeLessThanOrEqual(COORDINATE_TOLERANCE);
}

/**
 * Order-independent variant of `testCoordinates` for locators matching several
 * elements whose DOM order is nondeterministic (parallel <par> regions mount in
 * timing-dependent order, so `.nth(i)` does not reliably correspond to a fixed
 * region). Asserts the elements' bounding boxes match the expected
 * `[top, left, width, height]` entries 1:1, in any order.
 *
 * With `subset: true` the count check is relaxed: regions cycling out of phase
 * may legitimately show only some of the elements at a given instant, so each
 * PRESENT element must match a distinct expected entry, but not every entry
 * needs an element.
 */
export async function testCoordinatesAnyOrder(
	locator: Locator,
	expectedCoords: number[][],
	opts: { subset?: boolean } = {},
) {
	if (!opts.subset) {
		await expect(locator).toHaveCount(expectedCoords.length);
	}
	const remaining = [...expectedCoords];
	const count = await locator.count();
	expect(
		count,
		`found ${count} elements but only ${expectedCoords.length} expected positions`,
	).toBeLessThanOrEqual(expectedCoords.length);
	for (let i = 0; i < count; i++) {
		const box = await locator.nth(i).boundingBox();
		expect(box).not.toBeNull();
		const matchIndex = remaining.findIndex(
			([top, left, width, height]) =>
				Math.abs(box!.x - left) <= COORDINATE_TOLERANCE &&
				Math.abs(box!.y - top) <= COORDINATE_TOLERANCE &&
				Math.abs(box!.width - width) <= COORDINATE_TOLERANCE &&
				Math.abs(box!.height - height) <= COORDINATE_TOLERANCE,
		);
		expect(
			matchIndex,
			`box {x:${box!.x}, y:${box!.y}, w:${box!.width}, h:${box!.height}} matches none of the remaining expected [top,left,w,h] coords ${JSON.stringify(remaining)}`,
		).toBeGreaterThanOrEqual(0);
		remaining.splice(matchIndex, 1);
	}
}

/**
 * Wait until SOME element matched by the locator occupies the given
 * [top, left, width, height] box (within tolerance). Use when appearance at a
 * specific region is guaranteed only EVENTUALLY — e.g. parallel regions cycling
 * out of phase — so neither a fixed index nor an instantaneous set comparison
 * can assert it.
 */
export async function waitForCoordinates(
	locator: Locator,
	[top, left, width, height]: number[],
	timeout: number = Timeouts.elementAwait,
) {
	await expect
		.poll(
			async () => {
				const count = await locator.count();
				for (let i = 0; i < count; i++) {
					// Short timeout + catch: an element can detach between count()
					// and boundingBox() (video src nulled after playback).
					const box = await locator
						.nth(i)
						.boundingBox({ timeout: 1000 })
						.catch(() => null);
					if (
						box &&
						Math.abs(box.x - left) <= COORDINATE_TOLERANCE &&
						Math.abs(box.y - top) <= COORDINATE_TOLERANCE &&
						Math.abs(box.width - width) <= COORDINATE_TOLERANCE &&
						Math.abs(box.height - height) <= COORDINATE_TOLERANCE
					) {
						return true;
					}
				}
				return false;
			},
			{
				timeout,
				message: `no element at [top=${top}, left=${left}, w=${width}, h=${height}] within ${timeout}ms`,
			},
		)
		.toBe(true);
}

/**
 * Wait for the applet iframe to be visible, then return a FrameLocator.
 * Provides a clear error instead of silent null if the iframe never loads.
 */
export async function getAppletFrame(page: Page, timeout = Timeouts.firstElement): Promise<FrameLocator> {
	await expect(page.locator('iframe')).toBeVisible({ timeout });
	return page.frameLocator('iframe');
}

/**
 * Resolve the applet iframe's content `Frame` (the real frame object, not a
 * `FrameLocator`), retrying until its `<body>` is present. Unlike `getAppletFrame`
 * — which returns a `FrameLocator` for ordinary locator use — callers here need a
 * stable `Frame` handle for `frame.evaluate(...)` and for inspecting live DOM that
 * survives the player's iframe reloads across content updates. Throws after
 * `timeout` ms if no stable frame appears. Shared by the checkBeforePlay-family
 * specs (`checkBeforePlay`, `locationStrategyExtension`).
 */
export async function getStableAppletFrame(page: Page, timeout = 30000): Promise<Frame> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const iframeLocator = page.locator('iframe').first();
			await iframeLocator.waitFor({ state: 'attached', timeout: 5000 });
			const iframeHandle = await iframeLocator.elementHandle();
			const frame = await iframeHandle!.contentFrame();
			if (frame) {
				await frame.waitForSelector('body', { timeout: 5000 });
				return frame;
			}
		} catch {
			// Frame detached or not ready, retry
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error('Could not get stable applet iframe');
}

/**
 * Wait until EITHER the intro loader video mounts (cold prefetch path) OR any
 * content element is already visible (loader legitimately skipped — prefetch
 * finished before the intro mounted, the common case with a warm asset cache).
 * Returns without asserting either way; the caller's first-content assert
 * (with Timeouts.firstElement) is the real gate. Polls instead of a blind
 * 10s try/catch so the skipped-loader path doesn't burn 10s per test.
 */
export async function waitForLoaderOrSkip(page: Page) {
	const deadline = Date.now() + 10_000;
	const frame = page.frameLocator('iframe');
	while (Date.now() < deadline) {
		const loaderVisible = await page
			.locator('video[src*="loader"]')
			.isVisible()
			.catch(() => false);
		if (loaderVisible) {
			return;
		}
		// Loader skipped if any non-loader content already rendered: a video on
		// the main page, or an img/widget-iframe inside the applet iframe.
		const contentStarted =
			(await page
				.locator('video[src]:not([src*="loader"])')
				.first()
				.isVisible()
				.catch(() => false)) ||
			(await frame
				.locator('img, iframe')
				.first()
				.isVisible()
				.catch(() => false));
		if (contentStarted) {
			return;
		}
		await page.waitForTimeout(250);
	}
	// Neither showed within 10s — slow cold boot, not an error. Fall through;
	// the caller's first-content assert decides pass/fail with a 90s budget.
}

/**
 * Dispatch a widget trigger sosEvent inside the applet iframe.
 * The SMIL player listens for 'sosEvent' CustomEvents on the applet window.
 */
export async function dispatchWidgetTrigger(page: Page, triggerData: string) {
	const appletFrame = page.frames().find((f) => f.url().includes('/applet'));
	if (!appletFrame) throw new Error('Applet frame not found');
	await appletFrame.evaluate((data: string) => {
		window.dispatchEvent(new CustomEvent('sosEvent', { detail: data }));
	}, triggerData);
}

/**
 * Fire a synthetic `touchend` on the main-page document. The player binds mouse
 * triggers (origin="mouse") to BOTH `click` and `touchend`, sharing one handler
 * (playlistTriggers.ts watchOnTouchOnClick; triggerEnums.touchEventType =
 * 'touchend'). Every existing trigger test uses page.click, so the touch path is
 * otherwise never exercised — this dispatches the touch end of that shared path.
 */
export async function dispatchTouchEnd(page: Page) {
	await page.evaluate(() => {
		document.dispatchEvent(new Event('touchend', { bubbles: true }));
	});
}

/**
 * Creates a console log collector. Attach to a page BEFORE navigation.
 * Returns live arrays and helper methods for querying collected messages.
 * `maxMessages` caps the rolling buffer (default 10_000) to keep long-running
 * tests from growing the array without bound. Errors are uncapped — they are
 * expected to be rare and each one matters for diagnosis.
 */
export function createConsoleCollector(page: Page, opts: { maxMessages?: number } = {}) {
	const messages: Array<{ level: string; text: string; time: number }> = [];
	const errors: string[] = [];
	const maxMessages = opts.maxMessages ?? 10_000;

	page.on('console', (msg) => {
		messages.push({ level: msg.type(), text: msg.text(), time: Date.now() });
		if (messages.length > maxMessages) messages.shift();
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(err.message));

	return {
		messages,
		errors,
		/** Count messages matching a substring pattern */
		count: (pattern: string) => messages.filter((m) => m.text.includes(pattern)).length,
		/** Check if any error matches a pattern */
		hasError: (pattern: string) => errors.some((e) => e.includes(pattern)),
		/** Get all messages matching a pattern */
		matching: (pattern: string) => messages.filter((m) => m.text.includes(pattern)),
	};
}

/**
 * Wait until a console message pattern appears at least minCount times.
 * Uses Playwright's .toPass() for polling with retry.
 */
export async function waitForConsolePattern(
	collector: ReturnType<typeof createConsoleCollector>,
	pattern: string,
	minCount: number,
	timeout: number = 60000,
) {
	await expect(async () => {
		const count = collector.count(pattern);
		if (count < minCount) throw new Error(`"${pattern}": ${count}/${minCount}`);
	}).toPass({ intervals: [1000], timeout });
}

/**
 * Capture current DOM state from main page (videos) and applet iframe (images/iframes).
 */
export async function captureDomState(page: Page) {
	const videos = await page.evaluate(() =>
		Array.from(document.querySelectorAll('video')).map((v) => ({
			src: v.src || null,
			visible: v.offsetWidth > 0 && v.offsetHeight > 0,
			width: v.offsetWidth,
			height: v.offsetHeight,
			currentTime: v.currentTime || 0,
			paused: v.paused,
		})),
	);

	const appletFrame = page.frames().find((f) => f.url().includes(':8091') || f.url().includes('/applet'));

	let images: Array<{ src: string | null; visible: boolean; width: number; height: number }> = [];
	let iframes: Array<{ src: string | null; visible: boolean; width: number; height: number }> = [];

	if (appletFrame) {
		try {
			images = await appletFrame.evaluate(() =>
				Array.from(document.querySelectorAll('img')).map((img) => ({
					src: img.src || null,
					visible: img.offsetWidth > 0 && img.offsetHeight > 0,
					width: img.offsetWidth,
					height: img.offsetHeight,
				})),
			);
			iframes = await appletFrame.evaluate(() =>
				Array.from(document.querySelectorAll('iframe')).map((f) => ({
					src: f.src || null,
					visible: f.offsetWidth > 0 && f.offsetHeight > 0,
					width: f.offsetWidth,
					height: f.offsetHeight,
				})),
			);
		} catch (_e) {
			// Frame may have navigated
		}
	}

	return { videos, images, iframes };
}

/**
 * Assert a <video> on the main page is actively advancing (not frozen on a
 * single frame). Samples currentTime twice ~sampleMs apart and requires it to
 * increase. Use wherever the *liveness* of a video matters (background video,
 * stream, triggered video). Necessary because every .mp4 visibility-monitor
 * candidate is expectedSec:0 (record-only), so the monitor cannot catch a
 * frozen video — only its presence.
 */
export async function assertVideoAdvancing(
	page: Page,
	srcContains: string,
	opts: { sampleMs?: number; minDeltaSec?: number } = {},
) {
	const sampleMs = opts.sampleMs ?? 1500;
	const minDelta = opts.minDeltaSec ?? 0.3;
	const read = () =>
		page
			.locator(`video[src*="${srcContains}"]`)
			.evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused }));
	const a = await read();
	await page.waitForTimeout(sampleMs);
	const b = await read();
	expect(b.paused, `video ${srcContains} is paused`).toBe(false);
	// A live video either advances forward (b > a) or, if it looped past its end
	// during the sample window, wraps back to a smaller currentTime (b < a). Only
	// a frozen / decode-stalled video keeps currentTime constant. Looping fixtures
	// (e.g. a 4s video in an indefinite <par>) routinely wrap inside the window,
	// so requiring strictly-forward progress would false-fail ~once every few runs.
	const advanced = b.t - a.t >= minDelta;
	const wrapped = b.t < a.t - minDelta;
	expect(
		advanced || wrapped,
		`video ${srcContains} not advancing: currentTime ${a.t.toFixed(2)} -> ${b.t.toFixed(2)}`,
	).toBe(true);
}

/**
 * Asserts a higher-priority element (page-layer `videoSrc` + iframe `imgSrc`)
 * starts playing and then KEEPS playing — i.e. a lower-priority element arriving
 * later did not stop/pause it. Shared by the `priorityLower{Stop,Pause}` specs,
 * which differ only in their lower-priority follow-up. `beforeContinue` runs
 * between the initial and the still-playing check (e.g. asserting the lower
 * element is not yet visible); its placement preserves each spec's ordering.
 */
export async function assertHigherPriorityUninterrupted(
	page: Page,
	frame: FrameLocator,
	videoSrc: string,
	imgSrc: string,
	beforeContinue?: () => Promise<void>,
) {
	await expect(page.locator(`video[src*="${videoSrc}"]`)).toBeVisible({ timeout: Timeouts.firstElement });
	await expect(frame.locator(`img:visible[src*="${imgSrc}"]`)).toBeVisible({ timeout: Timeouts.elementAwait });

	if (beforeContinue) {
		await beforeContinue();
	}

	// Still playing → the higher-priority element was NOT stopped/paused.
	await expect(page.locator(`video[src*="${videoSrc}"]`)).toBeVisible({ timeout: Timeouts.elementAwait });
	await expect(frame.locator(`img:visible[src*="${imgSrc}"]`)).toBeVisible({ timeout: Timeouts.elementAwait });
}
