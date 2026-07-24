import { PriorityRule } from '../enums/priorityEnums';

export type PriorityObject = {
	priorityLevel: number;
	maxPriorityLevel: number;
	lower: PriorityRule;
	peer: PriorityRule;
	higher: PriorityRule;
	pauseDisplay?: string;
	/**
	 * Wallclock end (millis timestamp) of this priority class's currently ACTIVE
	 * scheduled content. Stamped by the traverser when a wallclock-windowed
	 * seq/par under this class starts playing. While it lies in the future, the
	 * class still owns its region across repeatCount passes: per-pass
	 * markFinished still runs (sibling handover within the class), but the
	 * cross-priority unpause is held until the window closes — otherwise a
	 * paused lower class wakes between passes and races the replay.
	 */
	activeWindowEnd?: number;
};

export type PriorityCoordination = {
	version: number;
	priority: number;
};
