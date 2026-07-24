import * as chai from 'chai';
import { applyDurationOverrides } from '../../../test-runner/duration/durationCandidates';
import { VisibilityCandidate } from '../../../test-runner/visibilityMonitor';

const expect = chai.expect;

describe('applyDurationOverrides', () => {
	const base: VisibilityCandidate[] = [
		{ key: 'a', srcContains: 'a', layer: 'frame', expectedSec: 3 },
		{ key: 'b', srcContains: 'b', layer: 'page', expectedSec: 0 },
	];

	it('returns base candidates unchanged when no override matches', () => {
		const out = applyDurationOverrides('fx', base, {});
		expect(out).to.deep.equal(base);
	});

	it('merges an override onto the matching `fixture/key`', () => {
		const out = applyDurationOverrides('fx', base, { 'fx/a': { maxOutliers: 1 } });
		expect(out[0]).to.include({ key: 'a', expectedSec: 3, maxOutliers: 1 });
		expect(out[1]).to.not.have.property('maxOutliers');
	});

	it('lets an override replace expectedSec (e.g. force record-only)', () => {
		const out = applyDurationOverrides('fx', base, { 'fx/a': { expectedSec: 0 } });
		expect(out[0].expectedSec).to.equal(0);
	});

	it('does not mutate the input candidates', () => {
		applyDurationOverrides('fx', base, { 'fx/a': { maxOutliers: 2 } });
		expect(base[0]).to.not.have.property('maxOutliers');
	});
});
