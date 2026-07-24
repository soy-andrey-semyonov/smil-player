import * as chai from 'chai';
import {
	getDynamicPlaylistAndId,
	getDynamicTagsFromPlaylist,
} from '../../../src/components/playlist/tools/dynamicPlaylistTools';
import { SMILFileObject } from '../../../src/models/filesModels';
import { DynamicPlaylistObject } from '../../../src/models/triggerModels';

const expect = chai.expect;

// Minimal smilObject exposing only the `.dynamic` map the function reads.
const smilWithDynamic = (dynamic: { [key: string]: DynamicPlaylistObject }): SMILFileObject =>
	({ dynamic } as unknown as SMILFileObject);
// Distinct sentinel media objects; the function returns them by reference.
const media = (tag: string): DynamicPlaylistObject => ({ tag } as unknown as DynamicPlaylistObject);

describe('dynamicPlaylistTools', () => {
	describe('getDynamicPlaylistAndId', () => {
		it('returns undefined id and media when the config has no data', () => {
			const result = getDynamicPlaylistAndId({}, smilWithDynamic({}));
			expect(result).to.eql({ dynamicPlaylistId: undefined, dynamicMedia: undefined });
		});

		it('matches a single config key against smilObject.dynamic', () => {
			const promo1 = media('promo1');
			const result = getDynamicPlaylistAndId({ data: 'promo1' }, smilWithDynamic({ promo1 }));
			expect(result.dynamicPlaylistId).to.be.equal('promo1');
			expect(result.dynamicMedia).to.be.equal(promo1);
		});

		it('returns undefined when no config key is present in dynamic', () => {
			const result = getDynamicPlaylistAndId({ data: 'missing' }, smilWithDynamic({ promo1: media('promo1') }));
			expect(result).to.eql({ dynamicPlaylistId: undefined, dynamicMedia: undefined });
		});

		it('splits comma-separated data and the last present key wins', () => {
			const promo1 = media('promo1');
			const promo2 = media('promo2');
			const result = getDynamicPlaylistAndId({ data: 'promo1,promo2' }, smilWithDynamic({ promo1, promo2 }));
			expect(result.dynamicPlaylistId).to.be.equal('promo2');
			expect(result.dynamicMedia).to.be.equal(promo2);
		});

		it('picks the only present key when others in the list are absent', () => {
			const promo1 = media('promo1');
			const result = getDynamicPlaylistAndId({ data: 'promo1,missing' }, smilWithDynamic({ promo1 }));
			expect(result.dynamicPlaylistId).to.be.equal('promo1');
			expect(result.dynamicMedia).to.be.equal(promo1);
		});
	});

	describe('getDynamicTagsFromPlaylist', () => {
		it('Should extract emitDynamic data values', () => {
			const playlist: any = {
				seq: {
					emitDynamic: { data: 'dynamic-tag-1' },
					video: { src: 'video.mp4' },
				},
			};
			const result = getDynamicTagsFromPlaylist(playlist);
			expect(result).to.deep.equal(['dynamic-tag-1']);
		});

		it('Should extract EXPERIMENTAL_emitDynamic (legacy) data values', () => {
			const playlist: any = {
				par: {
					EXPERIMENTAL_emitDynamic: { data: 'legacy-tag' },
				},
			};
			const result = getDynamicTagsFromPlaylist(playlist);
			expect(result).to.deep.equal(['legacy-tag']);
		});

		it('Should return empty array when no dynamic tags', () => {
			const playlist: any = {
				seq: {
					video: { src: 'video.mp4' },
					img: { src: 'image.png' },
				},
			};
			const result = getDynamicTagsFromPlaylist(playlist);
			expect(result).to.deep.equal([]);
		});

		it('Should handle nested playlist structures', () => {
			const playlist: any = {
				par: {
					seq: {
						emitDynamic: { data: 'nested-tag-1' },
						par: {
							emitDynamic: { data: 'nested-tag-2' },
						},
					},
					EXPERIMENTAL_emitDynamic: { data: 'top-level-legacy' },
				},
			};
			const result = getDynamicTagsFromPlaylist(playlist);
			expect(result).to.include('nested-tag-1');
			expect(result).to.include('nested-tag-2');
			expect(result).to.include('top-level-legacy');
			expect(result).to.have.lengthOf(3);
		});
	});
});
