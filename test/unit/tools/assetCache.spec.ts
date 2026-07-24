import { expect } from 'chai';
import * as path from 'path';
import { cachePathFor, shouldCache, CACHE_DIR } from '../../../test-runner/assetCache';
import { getFileName } from '../../../src/components/files/tools/fileName';

describe('test-runner/assetCache', () => {
	describe('cachePathFor', () => {
		it('maps a CDN url to CACHE_DIR/<player checksummed filename>', () => {
			const url = 'https://demo.signageos.io/smil/samples/assets/loader.mp4';
			expect(cachePathFor(url)).to.equal(path.join(CACHE_DIR, getFileName(url)));
		});

		it('distinguishes same basename under different paths (checksum differs)', () => {
			const a = cachePathFor('https://demo.signageos.io/a/video.mp4');
			const b = cachePathFor('https://demo.signageos.io/b/video.mp4');
			expect(a).to.not.equal(b);
		});

		it('distinguishes same path with different query strings', () => {
			const a = cachePathFor('https://demo.signageos.io/a/video.mp4?v=1');
			const b = cachePathFor('https://demo.signageos.io/a/video.mp4?v=2');
			expect(a).to.not.equal(b);
		});

		it('ignores the player\'s volatile __smil_version cache-buster param', () => {
			// The player appends a random __smil_version to every download URL
			// (src/components/files/tools/index.ts createVersionedUrl) but computes
			// its stored filename from the bare src. The cache key must do the same,
			// or every run misses.
			const bare = cachePathFor('https://demo.signageos.io/a/video.mp4');
			const v1 = cachePathFor('https://demo.signageos.io/a/video.mp4?__smil_version=123456_0');
			const v2 = cachePathFor('https://demo.signageos.io/a/video.mp4?__smil_version=999999_3');
			expect(v1).to.equal(bare);
			expect(v2).to.equal(bare);
		});

		it('strips __smil_version but keeps other query params', () => {
			const versioned = cachePathFor('https://demo.signageos.io/a/video.mp4?v=1&__smil_version=123456_0');
			const bare = cachePathFor('https://demo.signageos.io/a/video.mp4?v=1');
			expect(versioned).to.equal(bare);
		});
	});

	describe('shouldCache', () => {
		it('caches only GET 200', () => {
			expect(shouldCache('GET', 200)).to.equal(true);
		});

		it('never caches HEAD (Last-Modified update checks must stay live)', () => {
			expect(shouldCache('HEAD', 200)).to.equal(false);
		});

		it('never caches non-200 (notExistingMedia 404s must stay 404)', () => {
			expect(shouldCache('GET', 404)).to.equal(false);
			expect(shouldCache('GET', 304)).to.equal(false);
		});
	});
});
