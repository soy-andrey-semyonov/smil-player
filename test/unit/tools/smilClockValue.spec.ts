import * as chai from 'chai';
import { smilClockValueToSeconds } from '../../../test-runner/duration/smilClockValue';

const expect = chai.expect;

describe('smilClockValueToSeconds', () => {
	it('parses unit values', () => {
		expect(smilClockValueToSeconds('3s')).to.equal(3);
		expect(smilClockValueToSeconds('3000ms')).to.equal(3);
		expect(smilClockValueToSeconds('2min')).to.equal(120);
		expect(smilClockValueToSeconds('1h')).to.equal(3600);
		expect(smilClockValueToSeconds('3.5s')).to.equal(3.5);
	});

	it('treats a bare number as seconds', () => {
		expect(smilClockValueToSeconds('3')).to.equal(3);
		expect(smilClockValueToSeconds('10')).to.equal(10);
	});

	it('parses full and partial clock values', () => {
		expect(smilClockValueToSeconds('00:00:03')).to.equal(3);
		expect(smilClockValueToSeconds('01:02:03')).to.equal(3723);
		expect(smilClockValueToSeconds('02:03')).to.equal(123);
	});

	it('returns 0 (record-only) for non-enforceable durations', () => {
		expect(smilClockValueToSeconds('indefinite')).to.equal(0);
		expect(smilClockValueToSeconds('media')).to.equal(0);
		expect(smilClockValueToSeconds('')).to.equal(0);
		expect(smilClockValueToSeconds(undefined)).to.equal(0);
		expect(smilClockValueToSeconds(null)).to.equal(0);
		expect(smilClockValueToSeconds('garbage')).to.equal(0);
	});

	it('tolerates surrounding whitespace', () => {
		expect(smilClockValueToSeconds('  5s ')).to.equal(5);
	});
});
