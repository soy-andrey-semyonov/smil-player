import { test, expect } from '@playwright/test';
import { getFrozenFlags, LivenessSnapshot, VideoSample } from './livenessMonitor';

/**
 * Pure-function unit tests for `getFrozenFlags` — NO browser. We hand-build
 * synthetic `LivenessSnapshot[]` timelines (one sample every 400ms, mirroring
 * the live poll cadence) so each threshold is crossed / not-crossed
 * deterministically, and assert the diagnosis (flag count + which src), never
 * the implementation.
 */

const STEP_MS = 400;

interface SampleSpec {
	src?: string;
	currentTime: number;
	paused?: boolean;
	ended?: boolean;
	duration?: number;
	visible?: boolean;
	left?: number;
	top?: number;
}

function sample(spec: SampleSpec): VideoSample {
	return {
		src: spec.src ?? 'movie.mp4',
		currentTime: spec.currentTime,
		paused: spec.paused ?? false,
		ended: spec.ended ?? false,
		duration: spec.duration ?? 4,
		visible: spec.visible ?? true,
		// Region position. Single-region cases default to (0,0); the per-region
		// test sets distinct coordinates to prove src+position keying.
		left: spec.left ?? 0,
		top: spec.top ?? 0,
	};
}

/** One single-video snapshot per spec, spaced `STEP_MS` apart starting at t=0. */
function timeline(specs: SampleSpec[]): LivenessSnapshot[] {
	return specs.map((s, i) => ({ t: i * STEP_MS, videos: [sample(s)] }));
}

/** ct ramp 0, 0.4, 0.8, … up to and including `endSec` (advancing = live). */
function ramp(endSec: number, base?: Partial<SampleSpec>): SampleSpec[] {
	const out: SampleSpec[] = [];
	for (let ct = 0; ct <= endSec + 1e-9; ct += 0.4) {
		out.push({ ...base, currentTime: Math.round(ct * 10) / 10 });
	}
	return out;
}

/** `count` samples all held static at `ct` (a frozen / paused frame). */
function hold(ct: number, count: number, base?: Partial<SampleSpec>): SampleSpec[] {
	const out: SampleSpec[] = [];
	for (let i = 0; i < count; i++) out.push({ ...base, currentTime: ct });
	return out;
}

/** The canonical frozen-bug shape: advance 0→4, then sit static at 4.0 for ~26s. */
function frozenSpecs(src: string): SampleSpec[] {
	// ramp ends at t=4000 (ct=4.0); 65 static holds → last static at t=30000.
	return [...ramp(4, { src, duration: 4 }), ...hold(4.0, 65, { src, duration: 4 })];
}

test.describe('getFrozenFlags', () => {
	test('flags a video stuck on its last frame far past the flat 2s tolerance', () => {
		const snaps = timeline(frozenSpecs('movie.mp4'));
		const flags = getFrozenFlags(snaps);
		expect(flags.length).toBe(1);
		expect(flags[0].src).toBe('movie.mp4');
		expect(flags[0].stuckAtSec).toBeCloseTo(4, 1);
		expect(flags[0].durationSec).toBeCloseTo(4, 1);
		// ~26s static on the last frame (run spans t=4000..30000) — far past the flat 2s tolerance.
		expect(flags[0].visibleStuckMs).toBeGreaterThan(20000);
	});

	test('does not flag a looping video (currentTime wraps back = live)', () => {
		// 0→4, wrap to 0, repeat ×3. Every step jumps ≥0.4s (forward) or wraps
		// (backward drop) — no static run ever forms.
		const cycle = ramp(4);
		const snaps = timeline([...cycle, ...cycle, ...cycle]);
		expect(getFrozenFlags(snaps)).toEqual([]);
	});

	test('does not flag a pause that releases within the stuck tolerance', () => {
		// advance 0→4, hold at 4.0 for ~1.2s (< the flat 2s tolerance), then wrap
		// to 0 and advance again. SMIL pause blocks the event loop, so paused stays
		// false throughout — detection must NOT depend on it; the brief hold simply
		// resolves before the tolerance elapses.
		const snaps = timeline([
			...ramp(4),
			...hold(4.0, 3), // t=4400..5200 → run spans t=4000..5200 = 1200ms < 2000
			...ramp(4), // wrap to 0 then climb again
		]);
		expect(getFrozenFlags(snaps)).toEqual([]);
	});

	test('does not flag a brief window below minTotalVisibleMs', () => {
		// 9 visible static samples on an unknown-duration stream (last-frame
		// qualifier auto-passes) → totalVisible = 3200ms, stuck = 3200ms (> the 2s
		// maxStuckMs). With minTotalVisibleMs raised to 5000 the region was barely
		// on screen, so it is skipped despite exceeding the stuck threshold; the
		// positive control (gate at 0) proves the skip is the decisive gate.
		const snaps = timeline(hold(10.0, 9, { duration: 0 }));
		expect(getFrozenFlags(snaps, { minTotalVisibleMs: 5000 })).toEqual([]);
		// Same timeline, skip disabled → it DOES flag (proves the gate is decisive).
		expect(getFrozenFlags(snaps, { minTotalVisibleMs: 0 }).length).toBe(1);
	});

	test('flags an ended video stuck visible on its last frame beyond threshold', () => {
		// The conditionalMediaElement freeze shape: the clip plays once (advance
		// 0→4), reaches its end (ended flips true) and then sits FROZEN, still
		// visible on the last frame for ~26s without being replaced. "ended + still
		// visible + not replaced" IS the signage freeze. RED under the old
		// ended-exclusion (ended samples were dropped from runs → no flag).
		const snaps = timeline([
			...ramp(4, { duration: 4 }), // advance 0→4 (ended:false)
			...hold(4.0, 65, { ended: true, duration: 4 }), // then ended, frozen on last frame ~26s
		]);
		const flags = getFrozenFlags(snaps);
		expect(flags.length).toBe(1);
		expect(flags[0].stuckAtSec).toBeCloseTo(4, 1);
	});

	test('does not flag a briefly-ended video replaced within the tolerance', () => {
		// Normal end-of-clip transition: a clip ends and shows its last frame for
		// ~1.2s, then the next clip replaces it (visible:false). The skip is disabled
		// (minTotalVisibleMs:0) so the THRESHOLD is the sole gate: 1200ms < the flat
		// 2s tolerance → no flag, even though it is ended + on the last frame. This
		// keeps the now-included ended-on-last-frame runs from flagging at every
		// normal clip boundary.
		const snaps = timeline([
			...hold(4.0, 4, { ended: true, duration: 4 }), // ended+visible ~1.2s at last frame
			...hold(4.0, 10, { ended: true, duration: 4, visible: false }), // replaced → offscreen
		]);
		expect(getFrozenFlags(snaps, { minTotalVisibleMs: 0 })).toEqual([]);
	});

	test('per-region keying — flags only the frozen region when two regions share a src', () => {
		// conditionalMediaElement plays the SAME src in 4 regions. Grouping by bare
		// src merges a frozen element and a live one into one corrupted timeline.
		// Keying by src+position separates them. RED under the old bare-src merge.
		const SRC = 'shared.mp4';
		const regionA: SampleSpec[] = [
			...ramp(4, { src: SRC, duration: 4, left: 0, top: 0 }),
			...hold(4.0, 65, { src: SRC, ended: true, duration: 4, left: 0, top: 0 }), // frozen @ (0,0)
		];
		const liveCycle = ramp(4, { src: SRC, left: 500, top: 500 }); // advancing/looping @ (500,500)
		const regionB: SampleSpec[] = [];
		while (regionB.length < regionA.length) regionB.push(...liveCycle);
		const snaps: LivenessSnapshot[] = regionA.map((a, i) => ({
			t: i * STEP_MS,
			videos: [sample(a), sample(regionB[i])],
		}));
		const flags = getFrozenFlags(snaps);
		expect(flags.length).toBe(1);
		expect(flags[0].src).toBe(SRC);
		expect(flags[0].reason).toContain('@0,0'); // region A, not the live region B (@500,500)
	});

	test('does not flag a video that is never visible (src cleared / offscreen)', () => {
		const snaps = timeline(hold(4.0, 76, { visible: false }));
		expect(getFrozenFlags(snaps)).toEqual([]);
	});

	test('with multiple videos, flags only the frozen one', () => {
		const frozen = frozenSpecs('frozen.mp4');
		// A live looping companion of equal length, on its own src.
		const liveCycle = ramp(4, { src: 'live.mp4' });
		const live: SampleSpec[] = [];
		while (live.length < frozen.length) live.push(...liveCycle);
		const snaps: LivenessSnapshot[] = frozen.map((f, i) => ({
			t: i * STEP_MS,
			videos: [sample(f), sample(live[i])],
		}));
		const flags = getFrozenFlags(snaps);
		expect(flags.length).toBe(1);
		expect(flags[0].src).toBe('frozen.mp4');
	});

	test('does not flag a long static run that is not on the last frame', () => {
		// ramp 0→2, then sit static at 2.0 for ~22s — vastly over the flat 2s
		// tolerance, but 2.0 is mid-playback (< 3.5 = duration-0.5), so the last-
		// frame qualifier suppresses it. Under the flat threshold the qualifier is
		// the PRIMARY false-positive guard: this is exactly the intended mid-clip
		// priority-pause, which must NEVER flag at any duration. CRITICAL — dropping
		// or inverting the qualifier turns this red.
		const snaps = timeline([...ramp(2, { duration: 4 }), ...hold(2.0, 55, { duration: 4 })]);
		expect(getFrozenFlags(snaps)).toEqual([]);
	});

	test('flags a static last-frame run just over the 2s tolerance (~2.4s)', () => {
		// 400ms cadence: ramp 0→4 (last sample ct=4.0 @ t=4000), then 6 static holds
		// → last static @ t=6400. Run spans t=4000..6400 = 2400ms > 2000ms → flag.
		const snaps = timeline([...ramp(4, { duration: 4 }), ...hold(4.0, 6, { duration: 4 })]);
		const flags = getFrozenFlags(snaps);
		expect(flags.length).toBe(1);
		expect(flags[0].visibleStuckMs).toBe(2400);
	});

	test('does not flag a static last-frame run just under the 2s tolerance (~1.6s)', () => {
		// Same shape, 4 static holds → run spans t=4000..5600 = 1600ms < 2000ms → no
		// flag. The preceding ramp keeps totalVisible (5600ms) well over the skip, so
		// the THRESHOLD — not the minTotalVisibleMs skip — is what decides here.
		const snaps = timeline([...ramp(4, { duration: 4 }), ...hold(4.0, 4, { duration: 4 })]);
		expect(getFrozenFlags(snaps)).toEqual([]);
	});

	test('flags the terminal freeze even when a longer mid-playback hold precedes it', () => {
		// ramp 0→2, hold 2.0 for ~20s (mid-playback, LONGER), advance to 4.0, hold
		// 4.0 for ~16s (terminal, shorter). The 16s terminal freeze is the real bug;
		// the 20s mid-pause must NOT out-length and mask it. RED under "keep the
		// global-longest run, then qualify"; GREEN once last-frame gates selection.
		const snaps = timeline([
			...ramp(2, { duration: 4 }),
			...hold(2.0, 50, { duration: 4 }), // ~20s at 2.0 (mid-playback)
			...[2.4, 2.8, 3.2, 3.6, 4.0].map((currentTime) => ({ currentTime, duration: 4 })),
			...hold(4.0, 40, { duration: 4 }), // ~16s at 4.0 (terminal freeze)
		]);
		const flags = getFrozenFlags(snaps);
		expect(flags.length).toBe(1);
		expect(flags[0].stuckAtSec).toBeCloseTo(4, 1);
	});
});
