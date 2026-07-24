import * as chai from 'chai';
import { computeDurations, computeOccurrences, computeStats, selectOutlierViolations } from '../../../test-runner/visibilityMonitor';

const expect = chai.expect;

describe('visibilityMonitor math', () => {
	// transitions: [{t, layer, src}]; a cycle for a candidate is from a matching
	// src to the next transition on the same layer.
	const transitions = [
		{ t: 0, layer: 'frame' as const, src: 'a.jpg' },
		{ t: 3000, layer: 'frame' as const, src: 'b.jpg' },
		{ t: 6000, layer: 'frame' as const, src: 'a.jpg' },
		{ t: 9100, layer: 'frame' as const, src: 'b.jpg' },
	];
	const candA = { key: 'a', srcContains: 'a.jpg', layer: 'frame' as const, expectedSec: 3 };

	it('computeDurations returns each closed cycle length for a candidate', () => {
		expect(computeDurations(transitions, candA)).to.deep.equal([3000, 3100]);
	});

	it('computeOccurrences counts appearances, including an open-ended trailing one', () => {
		// candA appears at t=0 and t=6000 — both closed here -> 2 appearances.
		expect(computeOccurrences(transitions, candA)).to.equal(2);
		// An element that appears once and never gets a closing transition has
		// 0 CLOSED cycles but 1 appearance — the case minOccurrences must accept
		// (test ends while it is on screen / close races with teardown).
		const openEnded = [{ t: 0, layer: 'frame' as const, src: 'a.jpg' }];
		expect(computeDurations(openEnded, candA)).to.deep.equal([]);
		expect(computeOccurrences(openEnded, candA)).to.equal(1);
	});

	it('computeStats summarizes count/occurrences/avg/min/max/expected', () => {
		const s = computeStats(transitions, candA);
		expect(s).to.include({ key: 'a', count: 2, occurrences: 2, minMs: 3000, maxMs: 3100, expectedMs: 3000 });
		expect(s.avgMs).to.equal(3050);
	});

	it('selectOutlierViolations flags out-of-tolerance cycles, dropping the N worst first', () => {
		// durations 3000 (ok), 5000 (off by 2000). tol 800, maxOutliers 0 -> 1 violation.
		expect(selectOutlierViolations([3000, 5000], 3000, 800, 0).length).to.equal(1);
		// maxOutliers 1 drops the worst (5000) -> 0 violations.
		expect(selectOutlierViolations([3000, 5000], 3000, 800, 1).length).to.equal(0);
		// two genuinely-off cycles, maxOutliers 1 -> still 1 violation (can't drop both).
		expect(selectOutlierViolations([5000, 5200], 3000, 800, 1).length).to.equal(1);
	});
});
