import { expect, FrameLocator, Page } from '@playwright/test';

/**
 * Where to look for the element. Videos render on the main page; images and
 * widgets render inside the applet iframe (per the project's architecture).
 */
export type VisibilityLayer = 'page' | 'frame';

/**
 * Describes one element the monitor should watch.
 *
 * - `key`: short label used in transitions / error messages
 * - `srcContains`: substring matched against the element's `src` attribute
 * - `layer`: 'page' for main-page <video>, 'frame' for in-iframe <img>
 * - `expectedSec`: nominal on-screen duration in seconds. Compared against
 *   observed durations on `assertDurationsWithinTolerance`. Set to 0 to
 *   record transitions without enforcing a duration (useful for boot
 *   loaders or naturally-variable assets).
 * - `toleranceMs`: per-candidate override of the assert-wide tolerance.
 *   Use for elements that legitimately carry sync-coordination overhead
 *   inside their visible window (e.g. a punch-in element that holds the
 *   screen through a peer start-barrier / finish-ACK round-trip). Falls
 *   back to `assertDurationsWithinTolerance`'s `toleranceMs`, then 800.
 * - `minOccurrences`: minimum number of complete visibility cycles the
 *   monitor must observe before the assert is allowed to pass. Defaults
 *   to 1. Use 0 to skip the existence check entirely.
 * - `maxOutliers`: number of cycles that are allowed to fall outside the
 *   tolerance window without failing the assertion. Use for keys that are
 *   knowably cut short by an external event (e.g. a peer-pause boundary
 *   that interrupts a 3s img mid-display — the partial visible time is
 *   correct SMIL behavior, not a bug). Defaults to 0 (strict). When set,
 *   the *largest-deviation* outliers are dropped first so genuine
 *   regressions (e.g. multiple cycles wildly off-target) still fail.
 */
export interface VisibilityCandidate {
	key: string;
	srcContains: string;
	layer: VisibilityLayer;
	expectedSec: number;
	toleranceMs?: number;
	minOccurrences?: number;
	maxOutliers?: number;
}

/**
 * One observed visibility transition. The recorded `t` is "first observed at
 * the poll tick at or before the transition" — so durations carry up to one
 * poll interval (default ~100ms) of jitter on each end. We store the raw
 * `src` (no classified key) so candidates added later via `watch()` can still
 * be classified retroactively at stats / assert time.
 */
export interface Transition {
	t: number;
	layer: VisibilityLayer;
	src: string | null;
}

/** Per-element duration stats reported by `getStats()`. */
export interface KeyStats {
	key: string;
	/** Number of CLOSED cycles (open-ended trailing appearance excluded). */
	count: number;
	/** Number of APPEARANCES (open-ended included) — the `minOccurrences` signal. */
	occurrences: number;
	avgMs: number;
	minMs: number;
	maxMs: number;
	expectedMs: number;
}

export interface VisibilityMonitor {
	stop(): Promise<void>;
	/**
	 * Append candidates after the monitor has started. Transitions recorded
	 * before the call are classified retroactively at assert time, so
	 * `watch()` may be called any time before `assertDurationsWithinTolerance`.
	 * Useful for fixture-auto pattern where the monitor starts on page load
	 * and the test declares what to assert mid-body.
	 */
	watch(more: VisibilityCandidate[]): void;
	getTransitions(): Transition[];
	getStats(): KeyStats[];
	assertDurationsWithinTolerance(opts?: { toleranceMs?: number }): Promise<void>;
}

/**
 * Collect each cycle's observed duration (ms) for a candidate. A cycle starts at
 * a transition whose `src` matches the candidate's `srcContains` on the right
 * layer, and ends at the next transition on the same layer. The open-ended
 * trailing transition (no following same-layer transition) is excluded.
 *
 * Pure: depends only on its arguments, so it is unit-testable in isolation.
 */
export function computeDurations(transitions: Transition[], c: VisibilityCandidate): number[] {
	const out: number[] = [];
	for (let i = 0; i < transitions.length; i++) {
		const cur = transitions[i];
		if (cur.layer !== c.layer) continue;
		if (!cur.src || !cur.src.includes(c.srcContains)) continue;
		const next = transitions.slice(i + 1).find((x) => x.layer === cur.layer);
		if (!next) continue; // exclude the open-ended trailing transition
		out.push(next.t - cur.t);
	}
	return out;
}

/**
 * Count how many times a candidate's element APPEARED — the number of
 * transitions whose `src` matches on the candidate's layer. Unlike
 * `computeDurations` (which counts only CLOSED cycles, excluding the open-ended
 * trailing appearance), an appearance counts even if its closing transition was
 * never recorded. This is the right signal for `minOccurrences` ("did it play at
 * least N times?"): an element on screen when the test ends, or whose close
 * races with teardown under CPU load, has still genuinely played. Counting
 * closed cycles there produced spurious n=0 failures (playModeOne landscape2,
 * wallclockFuture video) for elements the test itself asserts appeared. Pure.
 */
export function computeOccurrences(transitions: Transition[], c: VisibilityCandidate): number {
	let n = 0;
	for (const t of transitions) {
		if (t.layer !== c.layer) continue;
		if (!t.src || !t.src.includes(c.srcContains)) continue;
		n++;
	}
	return n;
}

/**
 * Summarize a candidate's observed cycles into count/avg/min/max plus the
 * expected duration (ms). Pure wrapper over `computeDurations` /
 * `computeOccurrences`.
 */
export function computeStats(transitions: Transition[], c: VisibilityCandidate): KeyStats {
	const arr = computeDurations(transitions, c);
	return {
		key: c.key,
		count: arr.length,
		occurrences: computeOccurrences(transitions, c),
		avgMs: arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0,
		minMs: arr.length ? Math.min(...arr) : 0,
		maxMs: arr.length ? Math.max(...arr) : 0,
		expectedMs: Math.round(c.expectedSec * 1000),
	};
}

/**
 * From a candidate's observed `durations`, return human-readable descriptions of
 * the cycles that fall outside `toleranceMs` of `expectedMs`, after first
 * dropping the `maxOutliers` largest-deviation cycles. Dropping the worst first
 * means known boundary-cuts are tolerated while genuine multi-cycle regressions
 * (which can't all be dropped) still surface. Pure.
 */
export function selectOutlierViolations(
	durations: number[],
	expectedMs: number,
	toleranceMs: number,
	maxOutliers: number,
): string[] {
	const sorted = durations
		.map((d, i) => ({ d, delta: Math.abs(d - expectedMs), i }))
		.sort((a, b) => b.delta - a.delta);
	const dropped = new Set(sorted.slice(0, maxOutliers).map((x) => x.i));
	const violators: string[] = [];
	for (let i = 0; i < durations.length; i++) {
		if (dropped.has(i)) continue;
		const d = durations[i];
		if (Math.abs(d - expectedMs) > toleranceMs) {
			violators.push(`dur=${d}ms (delta ${d - expectedMs > 0 ? '+' : ''}${d - expectedMs}ms)`);
		}
	}
	return violators;
}

/**
 * Start polling the page + applet frame for visibility transitions of the
 * given candidate elements. Spawn early in the test (or in a fixture), then
 * optionally append candidates via `watch()`, run the test, and call
 * `assertDurationsWithinTolerance()` at the end.
 *
 * Why polling instead of MutationObserver: an MO inside the iframe is
 * cleaner but requires `addInitScript` plus message-channel plumbing, and
 * the player already sets visibility via inline style mutations that an MO
 * would see; 100ms polling is empirically adequate for ±800ms tolerance.
 *
 * Important: each transition's recorded `t` is "first observed at or
 * before the next poll" — so observed durations carry up to one poll
 * interval (≈100ms) of jitter on each end. Pick toleranceMs accordingly.
 */
export function startVisibilityMonitor(
	page: Page,
	frame: FrameLocator,
	initialCandidates: VisibilityCandidate[],
	opts: { pollMs?: number } = {},
): VisibilityMonitor {
	const pollMs = opts.pollMs ?? 100;
	const transitions: Transition[] = [];
	const candidates: VisibilityCandidate[] = [...initialCandidates];
	const t0 = Date.now();
	let stopped = false;

	// Snapshot per-layer last-observed raw src so we only push genuine
	// transitions. We track raw src (not classified key) so that watch() can
	// add candidates after the fact without losing earlier transitions.
	let lastPageSrc: string | null = null;
	let lastFrameSrc: string | null = null;


	async function visibleSrcOnPage(): Promise<string | null> {
		try {
			return await page.locator('video').evaluateAll((els) => {
				const v = (els as HTMLVideoElement[]).find((x) =>
					!!x.src &&
					x.offsetWidth > 0 && x.offsetHeight > 0 &&
					getComputedStyle(x).visibility !== 'hidden',
				);
				return v ? v.src : null;
			});
		} catch {
			return null;
		}
	}

	async function visibleSrcInFrame(): Promise<string | null> {
		try {
			return await frame.locator('img').evaluateAll((els) => {
				const v = (els as HTMLImageElement[]).find((x) =>
					!!x.src &&
					x.offsetWidth > 0 && x.offsetHeight > 0 &&
					getComputedStyle(x).visibility !== 'hidden',
				);
				return v ? v.src : null;
			});
		} catch {
			return null;
		}
	}

	const loop = (async () => {
		while (!stopped) {
			let pageSrc: string | null = null;
			let frameSrc: string | null = null;
			try {
				[pageSrc, frameSrc] = await Promise.all([
					visibleSrcOnPage(),
					visibleSrcInFrame(),
				]);
			} catch {
				// Page closed under us (teardown race); exit the loop quietly.
				break;
			}
			const now = Date.now() - t0;
			if (pageSrc !== lastPageSrc) {
				transitions.push({ t: now, layer: 'page', src: pageSrc });
				lastPageSrc = pageSrc;
			}
			if (frameSrc !== lastFrameSrc) {
				transitions.push({ t: now, layer: 'frame', src: frameSrc });
				lastFrameSrc = frameSrc;
			}
			await new Promise((r) => setTimeout(r, pollMs));
		}
	})();

	const stop = async () => {
		stopped = true;
		await loop;
	};

	const watch = (more: VisibilityCandidate[]) => {
		candidates.push(...more);
	};

	const getStats = (): KeyStats[] => candidates.map((c) => computeStats(transitions, c));

	const assertDurationsWithinTolerance = async (
		opts: { toleranceMs?: number } = {},
	) => {
		const assertTolerance = opts.toleranceMs ?? 800;
		const stats = getStats();
		const failures: string[] = [];
		for (const c of candidates) {
			const tolerance = c.toleranceMs ?? assertTolerance;
			const s = stats.find((x) => x.key === c.key)!;
			const minOcc = c.minOccurrences ?? 1;
			// minOccurrences = "appeared at least N times?" — checked against
			// APPEARANCES, not closed cycles. An element on screen at test end, or
			// whose close races with teardown under load, has still played; the
			// duration tolerance below still uses ONLY closed cycles, so an
			// open-ended appearance contributes no (possibly stale-timed) cycle to
			// check — that avoids both the spurious n=0 failure and any inflated
			// last-cycle duration.
			if (s.occurrences < minOcc) {
				failures.push(
					`${c.key}: only ${s.occurrences} appearance(s), expected at least ${minOcc}`,
				);
				continue;
			}
			if (c.expectedSec <= 0) continue;
			const exp = s.expectedMs;
			const durations = computeDurations(transitions, c);
			// maxOutliers > 0 means "this key has known boundary-cuts; tolerate
			// the N worst" — selectOutlierViolations drops the largest-deviation
			// cycles first, so genuine regressions (multiple cycles all wrong)
			// still surface because they can't all be dropped.
			const maxOutliers = c.maxOutliers ?? 0;
			const violators = selectOutlierViolations(durations, exp, tolerance, maxOutliers);
			if (violators.length > 0) {
				const droppedCount = Math.min(maxOutliers, durations.length);
				const droppedDesc = maxOutliers > 0
					? ` (after dropping ${droppedCount} worst outlier${droppedCount === 1 ? '' : 's'})`
					: '';
				failures.push(
					`${c.key}: expected ${exp}ms ±${tolerance}ms, ` +
					`got ${violators.length}/${durations.length - droppedCount} out of tolerance${droppedDesc}: ` +
					`[${violators.join(', ')}]`,
				);
			}
		}
		if (failures.length > 0) {
			const summary = stats.map((s) =>
				`  ${s.key.padEnd(16)} app=${String(s.occurrences).padStart(2)} cyc=${String(s.count).padStart(2)} ` +
				`avg=${String(s.avgMs).padStart(5)}ms  min=${String(s.minMs).padStart(5)}  max=${String(s.maxMs).padStart(5)}  ` +
				`expected=${s.expectedMs}ms`,
			).join('\n');
			expect.soft(failures, `Visibility-duration assertions failed:\n${summary}\n\n${failures.join('\n')}`).toEqual([]);
		}
	};

	return {
		stop,
		watch,
		getTransitions: () => transitions.slice(),
		getStats,
		assertDurationsWithinTolerance,
	};
}
