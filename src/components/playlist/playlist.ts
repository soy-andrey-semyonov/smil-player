import {initSyncObject} from './tools/syncTools';
import {PlaylistProcessor} from './playlistProcessor/playlistProcessor';
import FrontApplet from '@signageos/front-applet/es6/FrontApplet/FrontApplet';
import {PlaylistDataPrepare} from './playlistDataPrepare/playlistDataPrepare';
import {PlaylistOptions} from '../../models/playlistModels';
import {IFilesManager} from "../files/IFilesManager";

export class SmilPlayerPlaylist {
	public readonly processor: PlaylistProcessor;
	public readonly dataPrepare: PlaylistDataPrepare;
	private options: PlaylistOptions = {
		cancelFunction: [],
		currentlyPlaying: {},
		promiseAwaiting: {},
		currentlyPlayingPriority: {},
		synchronization: initSyncObject(),
	};

	constructor(sos: FrontApplet, files: IFilesManager) {
		this.processor = new PlaylistProcessor(sos, files, this.options);
		this.dataPrepare = new PlaylistDataPrepare(sos, files, this.options);
	}
}
