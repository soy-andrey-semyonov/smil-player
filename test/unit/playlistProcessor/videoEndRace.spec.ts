import * as chai from 'chai';
import { needsUnknownDurationBackstop } from '../../../src/components/playlist/tools/generalTools';
import { SMILVideo } from '../../../src/models/mediaModels';

const expect = chai.expect;

const baseVideo = (overrides: object = {}): SMILVideo =>
	({ src: 'https://example.com/a.mp4', localFilePath: 'videos/a.mp4', ...overrides } as SMILVideo);

describe('Playlist tools', () => {
	describe('needsUnknownDurationBackstop', () => {
		it('true when neither fullVideoDuration nor dur is available', () => {
			expect(needsUnknownDurationBackstop(baseVideo())).to.equal(true);
		});

		it('true when fullVideoDuration is the defaultVideoDuration sentinel (0)', () => {
			expect(needsUnknownDurationBackstop(baseVideo({ fullVideoDuration: 0 }))).to.equal(true);
		});

		it('false when fullVideoDuration is known', () => {
			expect(needsUnknownDurationBackstop(baseVideo({ fullVideoDuration: 20000 }))).to.equal(false);
		});

		it('false when dur attribute is present', () => {
			expect(needsUnknownDurationBackstop(baseVideo({ dur: '20' }))).to.equal(false);
		});
	});
});
