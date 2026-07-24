import { Page } from '@playwright/test';

/**
 * One sampled reading of a single <video> element on the main page.
 *
 * `duration` is reported as 0 when the element's `duration` is NaN/Infinity
 * (e.g. an as-yet-unbuffered file or a live stream). `paused` and `ended` are
 * captured for diagnostics ONLY and are unreliable as liveness signals: a
 * stalled video can report `paused:false` (SMIL priority pausing blocks the JS
 * event loop instead of calling `video.pause()`), and a clip that played to its
 * end and then sits frozen on the last frame reports `ended:true` while STILL
 * visible. Liveness must therefore key on `currentTime` over time, never on
 * `paused`/`ended`.
 *
 * `left`/`top` are the element's rounded viewport position, used to key
 * timelines per REGION: a SMIL playlist can render the same `src` in several
 * regions at once, so grouping by bare `src` would merge a frozen element and a
 * live one into one corrupted timeline. Known limitation: a region whose rounded
 * position oscillates on a sub-pixel boundary (or that moves mid-play) splits
 * into separate keys — at worst masking a freeze, never fabricating one.
 */
export interface VideoSample {
	src: string;
	currentTime: number;
	paused: boolean;
	ended: boolean;
	duration: number; // 0 when NaN/Infinity (streams)
	visible: boolean;
	left: number;
	top: number;
}

/** One poll tick: all main-page <video> readings at offset `t` ms from start. */
export interface LivenessSnapshot {
	t: number;
	videos: VideoSample[];
}

/**
 * Tuning knobs for `getFrozenFlags`. All optional; defaults are documented per
 * field and applied inside the function so callers can override one in isolation.
 */
export interface FrozenOptions {
	maxStuckMs?: number; // default 2000 — flag if stuck visible on the LAST frame longer than this (flat, not scaled)
	minTotalVisibleMs?: number; // default 2000 — ignore regions barely on screen (a >2s freeze is visible >=2s)
	staticEpsilonSec?: number; // default 0.10 — currentTime delta below this = not advancing
}

/** A diagnosis that one video src was stuck on a trailing frame too long. */
export interface FrozenFlag {
	src: string;
	stuckAtSec: number;
	durationSec: number;
	visibleStuckMs: number;
	totalVisibleMs: number;
	reason: string;
}

export interface LivenessMonitor {
	stop(): Promise<void>;
	getSnapshots(): LivenessSnapshot[];
	getFrozenFlags(opts?: FrozenOptions): FrozenFlag[];
}

/**
 * Read every <video> on the main page once. Returns [] if the page is closing
 * under us (teardown race) — same guard as `visibilityMonitor.ts`.
 */
async function sampleVideos(page: Page): Promise<VideoSample[]> {
	try {
		return await page.locator('video').evaluateAll((els) =>
			(els as HTMLVideoElement[]).map((x) => {
				const r = x.getBoundingClientRect();
				return {
					src: x.src || '',
					currentTime: x.currentTime,
					paused: x.paused,
					ended: x.ended,
					duration: Number.isFinite(x.duration) ? x.duration : 0,
					visible:
						!!x.src &&
						x.offsetWidth > 0 &&
						x.offsetHeight > 0 &&
						getComputedStyle(x).visibility !== 'hidden',
					left: Math.round(r.left),
					top: Math.round(r.top),
				};
			}),
		);
	} catch {
		return []; // page closed under us during teardown — same guard as visibilityMonitor.ts
	}
}

/**
 * Start sampling all main-page <video> elements every `pollMs` (400ms). Each
 * tick records a snapshot of every video's currentTime/paused/ended/duration/
 * visibility. Call `stop()` at test end, then `getFrozenFlags()` to diagnose any
 * video that sat stuck on its last frame longer than a flat tolerance (default 2s).
 *
 * Mirrors the poll-loop/teardown shape of `startVisibilityMonitor`.
 */
export function startLivenessMonitor(page: Page): LivenessMonitor {
	const pollMs = 400;
	const snapshots: LivenessSnapshot[] = [];
	const t0 = Date.now();
	let stopped = false;

	const loop = (async () => {
		while (!stopped) {
			const videos = await sampleVideos(page);
			snapshots.push({ t: Date.now() - t0, videos });
			await new Promise((r) => setTimeout(r, pollMs));
		}
	})();

	const stop = async () => {
		stopped = true;
		await loop;
	};

	return {
		stop,
		getSnapshots: () => snapshots.slice(),
		getFrozenFlags: (opts?: FrozenOptions) => getFrozenFlags(snapshots, opts),
	};
}

interface TimelineEntry {
	t: number;
	currentTime: number;
	visible: boolean;
	duration: number;
}

interface RegionGroup {
	src: string;
	left: number;
	top: number;
	entries: TimelineEntry[];
}

/**
 * Pure analysis: from a series of snapshots, return one `FrozenFlag` per REGION
 * (src + viewport position) that sat stuck on its last frame longer than the
 * flat `maxStuckMs` tolerance. Content should not sit stuck on screen, so the
 * tolerance is a FLAT 2s regardless of clip length — NOT scaled to duration. The
 * emitted `FrozenFlag.src` is the bare src (callers such as the
 * `allowFrozenVideos` opt-out filter by src substring); the `@left,top` region
 * is appended to `reason` for triage.
 *
 * Per region (distinct non-empty src at a distinct rounded left,top):
 *  1. Build its ordered timeline of {t, currentTime, visible, duration}.
 *  2. totalVisibleMs = sum of contiguous visible spans; skip the region entirely
 *     if it never accrued `minTotalVisibleMs` on screen (barely-on-screen window;
 *     a real >2s freeze is by definition visible >=2s, so this cannot hide one).
 *  3. Among its static runs — maximal contiguous blocks of VISIBLE samples whose
 *     currentTime spread stays under `staticEpsilonSec` (a forward advance OR a
 *     loop-wrap drop >= epsilon ends the run; a wrap means the video looped and is
 *     alive, same "wrap is live" rule as helpers.ts) — keep only those sitting on
 *     the LAST frame (within 0.5s of the run's duration, or duration unknown) and
 *     pick the LONGEST. Membership does NOT exclude `ended` samples: a real
 *     LAST-FRAME freeze (the par-repeat-indefinite bug, or any clip that plays
 *     to its end and is never replaced) sits at ended:true on the last frame and
 *     stays visible — "ended + still visible + not replaced" IS the signage
 *     freeze. The last-frame qualifier — applied during selection, not to the
 *     global-longest run afterward — is the PRIMARY false-positive guard: an
 *     intended MID-CLIP hold (a lower-priority video paused part-way through
 *     while higher-priority content plays) freezes BEFORE the last frame, so it
 *     never qualifies, at ANY duration. It also stops a long mid-clip hold from
 *     out-lengthing and masking a genuine terminal freeze on the same region.
 *     (Exception: for stream content with unknown duration the qualifier always
 *     passes, so such content is gated by the flat threshold + minTotalVisibleMs
 *     alone — calibration found no stream false positives.)
 *  4. Flag iff the chosen run outlasts the flat `maxStuckMs` (default 2000ms).
 *     durationSec is reported for triage but does NOT scale the threshold.
 *
 * `paused`/`ended` are captured in the samples for diagnostics but NEVER gate
 * this decision — a stalled video can report paused:false (priority pausing
 * blocks the event loop), and an ended-on-last-frame freeze is caught by the
 * currentTime-at-last-frame logic regardless of the ended flag.
 */
export function getFrozenFlags(snapshots: LivenessSnapshot[], opts: FrozenOptions = {}): FrozenFlag[] {
	const maxStuckMs = opts.maxStuckMs ?? 2000;
	const minTotalVisibleMs = opts.minTotalVisibleMs ?? 2000;
	const staticEpsilonSec = opts.staticEpsilonSec ?? 0.1;

	// Group each non-empty src's samples into a per-region ordered timeline.
	// The region key is `src@left,top`: the same src rendered in several regions
	// at once must not merge into one corrupted timeline. (Two distinct elements
	// sharing a src at the SAME rounded left,top — e.g. a crossfade overlap —
	// collapse into one timeline; that can only break a static run and mask a
	// freeze, never fabricate one, so it stays conservative.)
	const byRegion = new Map<string, RegionGroup>();
	for (const snap of snapshots) {
		for (const v of snap.videos) {
			if (!v.src) continue;
			const key = `${v.src}@${v.left},${v.top}`;
			let group = byRegion.get(key);
			if (!group) {
				group = { src: v.src, left: v.left, top: v.top, entries: [] };
				byRegion.set(key, group);
			}
			group.entries.push({ t: snap.t, currentTime: v.currentTime, visible: v.visible, duration: v.duration });
		}
	}

	const flags: FrozenFlag[] = [];
	for (const group of byRegion.values()) {
		const timeline = group.entries.slice().sort((a, b) => a.t - b.t);

		// (2) Sum of contiguous visible spans (first→last t of each run).
		let totalVisibleMs = 0;
		let spanStart = -1;
		for (let i = 0; i < timeline.length; i++) {
			if (timeline[i].visible) {
				if (spanStart < 0) spanStart = timeline[i].t;
			} else if (spanStart >= 0) {
				totalVisibleMs += timeline[i - 1].t - spanStart;
				spanStart = -1;
			}
		}
		if (spanStart >= 0) totalVisibleMs += timeline[timeline.length - 1].t - spanStart;
		// Skip regions that were barely on screen (pre-roll/transition). At default
		// tuning minTotalVisibleMs == maxStuckMs (2000), so this can never hide a
		// real freeze: a region stuck > 2000ms is, by definition, visible >= 2000ms.
		if (totalVisibleMs < minTotalVisibleMs) continue;

		// (3) Longest LAST-FRAME static run of VISIBLE samples (ended or not) with
		// sub-epsilon spread. The last-frame qualifier is applied during selection
		// (not after picking the global-longest run): otherwise a long mid-playback
		// hold — e.g. a mid-clip pause well before the end — out-lengths a genuine
		// terminal freeze on the same src and masks it. Only runs sitting on the
		// last frame (within 0.5s of duration, or duration unknown) are candidates.
		let bestStuckMs = -1;
		let bestStuckAt = 0;
		let bestDuration = 0;
		let runStart = -1;
		let runMin = 0;
		let runMax = 0;
		let runDuration = 0;
		const closeRun = (endIdx: number) => {
			if (runStart < 0) return;
			const onLastFrame = runDuration === 0 || runMin >= runDuration - 0.5;
			if (!onLastFrame) return;
			const stuckMs = timeline[endIdx].t - timeline[runStart].t;
			if (stuckMs > bestStuckMs) {
				bestStuckMs = stuckMs;
				bestStuckAt = runMin; // min ≈ max within epsilon — the static value
				bestDuration = runDuration;
			}
		};
		for (let i = 0; i < timeline.length; i++) {
			const e = timeline[i];
			if (!e.visible) {
				closeRun(i - 1);
				runStart = -1;
				continue;
			}
			if (runStart < 0) {
				runStart = i;
				runMin = e.currentTime;
				runMax = e.currentTime;
				runDuration = e.duration;
				continue;
			}
			const newMin = Math.min(runMin, e.currentTime);
			const newMax = Math.max(runMax, e.currentTime);
			if (newMax - newMin >= staticEpsilonSec) {
				// Advanced or wrapped — this sample is live; close the run and reseed.
				closeRun(i - 1);
				runStart = i;
				runMin = e.currentTime;
				runMax = e.currentTime;
				runDuration = e.duration;
			} else {
				runMin = newMin;
				runMax = newMax;
				runDuration = Math.max(runDuration, e.duration);
			}
		}
		closeRun(timeline.length - 1);

		// No qualifying (last-frame) static run found for this region.
		if (bestStuckMs < 0) continue;
		const durationSec = bestDuration;
		// Flat tolerance: content must not sit stuck longer than maxStuckMs (2s),
		// regardless of clip length. The last-frame qualifier above (not this
		// threshold) is what spares intended mid-clip holds.
		if (bestStuckMs > maxStuckMs) {
			// Rounded for human triage; the numeric
			// fields below stay full-precision for programmatic assertions. The
			// @left,top region disambiguates which copy of a multi-region src froze.
			const atSec = bestStuckAt.toFixed(2);
			const durSec = durationSec.toFixed(2);
			const stuckMs = Math.round(bestStuckMs);
			flags.push({
				src: group.src,
				stuckAtSec: bestStuckAt,
				durationSec,
				visibleStuckMs: bestStuckMs,
				totalVisibleMs,
				reason: `stuck at ${atSec}s for ${stuckMs}ms (duration ${durSec}s) @${group.left},${group.top}`,
			});
		}
	}
	return flags;
}
