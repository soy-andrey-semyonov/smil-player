import { expect } from 'chai';
import { assertUniqueBasenames, candidatesFromXml } from '../../../test-runner/duration/generateExpectations';

describe('test-runner/duration/generateExpectations', () => {
	describe('assertUniqueBasenames', () => {
		it('accepts unique basenames across directories', () => {
			expect(() =>
				assertUniqueBasenames(['playback/correctOrder.smil', 'wallclock/wallclockFuture.smil']),
			).to.not.throw();
		});

		it('accepts an empty file list', () => {
			expect(() => assertUniqueBasenames([])).to.not.throw();
		});

		it('throws on a duplicate basename in different directories', () => {
			expect(() => assertUniqueBasenames(['playback/x.smil', 'syncFiles/x.smil'])).to.throw(
				/duplicate fixture basename "x"/,
			);
		});
	});

	describe('candidatesFromXml', () => {
		const SMIL = `<smil><body><par>
			<seq end="__prefetchEnd.endEvent">
				<seq repeatCount="indefinite">
					<video src="https://demo.signageos.io/smil/samples/assets/loader.mp4"/>
				</seq>
			</seq>
			<seq>
				<prefetch src="https://demo.signageos.io/smil/samples/assets/landscape1.jpg"/>
				<seq id="__prefetchEnd" dur="1s"/>
			</seq>
			<par begin="__prefetchEnd.endEvent" repeatCount="indefinite">
				<seq repeatCount="indefinite">
					<img src="https://demo.signageos.io/smil/samples/assets/landscape1.jpg" dur="3s"/>
				</seq>
			</par>
		</par></body></smil>`;

		it('marks intro media (inside end="__prefetchEnd.endEvent") with minOccurrences: 0', async () => {
			const candidates = await candidatesFromXml(SMIL, 'inline-fixture');
			const loader = candidates.find((c) => c.key.startsWith('loader'));
			expect(loader, 'loader candidate missing').to.not.equal(undefined);
			expect(loader!.minOccurrences).to.equal(0);
		});

		it('leaves non-intro media without a minOccurrences override', async () => {
			const candidates = await candidatesFromXml(SMIL, 'inline-fixture');
			const img = candidates.find((c) => c.key.startsWith('landscape1'));
			expect(img, 'landscape1 candidate missing').to.not.equal(undefined);
			expect(img!.minOccurrences).to.equal(undefined);
			expect(img!.expectedSec).to.equal(3);
		});
	});
});
