import { VisibilityCandidate } from '../visibilityMonitor';

/**
 * Hand-authored adjustments the SMIL itself can't express. Keyed by
 * `${fixtureName}/${candidateKey}`, where candidateKey is the `key` field in
 * durationExpectations.generated.ts (== srcContains). Merged ON TOP of the
 * generated candidate by `durationCandidates`.
 *
 * Use for:
 *  - `maxOutliers`: cycles a priority/wallclock boundary legitimately cuts short.
 *  - `toleranceMs`: sync-coordinated holds that carry extra on-screen time.
 *  - `expectedSec: 0`: force record-only for naturally-variable assets.
 *  - `minOccurrences`: prove looping (>1) or allow optional elements (0).
 *
 * Add entries during each migration task's calibration step, with a comment
 * explaining WHY the SMIL `dur` is not directly assertable.
 */
export const DURATION_OVERRIDES: Record<string, Partial<VisibilityCandidate>> = {
	// queryStringMedia: both image candidates have port-dependent hashes.
	// The test server rewrites localhost:3000→localhost:310x in SMIL content at runtime,
	// so the player stores files under hashes computed from the rewritten URL — which differs
	// from the hash the generator computed against the raw (port-3000) SMIL file.
	// The monitor therefore never observes a src match; minOccurrences:0 opts out of the
	// count check without masking genuine duration errors (expectedSec is 0 or 3 but n=0
	// means the duration check is skipped per assertDurationsWithinTolerance logic).
	'queryStringMedia/landscape1_afd29522.jpg': { minOccurrences: 0 },
	'queryStringMedia/landscape2_fe44d808.jpg': { minOccurrences: 0 },

	// repeatCountIntroImage: video-test_0b02adc4 plays once (repeatCount=2 back-to-back =
	// one visibility span) right at the end of the asserted sequence; the test ends moments
	// after it disappears, and with a warm asset cache the whole sequence shifts ~10s earlier,
	// leaving the monitor's first-match page slot prone to recording the span as open/shadowed
	// (observed n=0 on 2026-06-11 while the test's own toBeVisible/not.toBeVisible asserts for
	// the same element passed). Appearance AND disappearance are asserted explicitly by the
	// test, so the occurrence check adds nothing here.
	'repeatCountIntroImage/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// triggersMouseDuration: img_2 appears in both the default playlist and the trigger2 seq.
	// The mouse click fires while img_2 is mid-display in the default playlist, cutting that
	// one cycle short — expected trigger-boundary behaviour, not a duration bug.
	'triggersMouseDuration/img_2_18b5d21f.jpg': { maxOutliers: 1 },

	// triggersMouse: img_2 is in the default playlist; multiple mouse clicks occur during the
	// test while img_2 is on screen, cutting one cycle short at a trigger boundary.
	'triggersMouse/img_2_18b5d21f.jpg': { maxOutliers: 1 },

	// triggersKeyboard: img_2 in the default playlist is cut short when trigger2 fires.
	'triggersKeyboard/img_2_18b5d21f.jpg': { maxOutliers: 1 },
	// img_4 belongs to trigger2's seq; trigger1 fires while trigger2 is active, cancelling
	// img_4's only display cycle — correct cross-trigger preemption behaviour.
	'triggersKeyboard/img_4_d0d404bb.jpg': { maxOutliers: 1 },

	// priorityStuckGallery: img_2 belongs to the permanently-expired sibling campaign
	// (wallclock 2020, mirrors the customer playlist that exposed the parent-hash-drift
	// deadlock) — by design it never plays.
	'priorityStuckGallery/img_2_18b5d21f.jpg': { minOccurrences: 0 },

	// triggersCrossCancel: trigger1 content (video-test-2 → img_4) is cancelled by trigger2
	// before img_4 can play; in the second test trigger1 is never activated at all.
	'triggersCrossCancel/img_4_d0d404bb.jpg': { minOccurrences: 0 },
	// These candidates appear in the full default-playlist loop, but the second test (trigger2
	// fires immediately on an idle player) ends before any complete cycle can be observed.
	'triggersCrossCancel/video-test_465b7757.mp4': { minOccurrences: 0 },
	'triggersCrossCancel/img_2_18b5d21f.jpg': { minOccurrences: 0 },
	'triggersCrossCancel/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// triggersStop: three tests share this fixture; not all candidates are reachable in
	// every test path.
	// img_4 belongs to trigger1 (keyboard 789). Tests 1 and 2 use trigger2 (mouse click)
	// only — trigger1 never fires, so img_4 never appears.
	'triggersStop/img_4_d0d404bb.jpg': { minOccurrences: 0 },
	// img_2 is in both the default playlist and trigger2's seq. In test 1 the mouse click
	// interrupts img_2 mid-cycle (one cut cycle is correct trigger-boundary behaviour); in
	// test 3 (trigger1 path) img_2 is never reached before the test ends.
	'triggersStop/img_2_18b5d21f.jpg': { minOccurrences: 0, maxOutliers: 1 },
	// video-test_0b02adc4 is trigger2's video. Test 3 exercises trigger1 only, so it never
	// plays.
	'triggersStop/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// wallclockFixedParWebsite: the <ref> website element renders in a nested iframe inside
	// the applet iframe. The visibility monitor polls <video> (page) and <img> (applet
	// iframe) only — it does NOT observe nested website iframes. The _0bd0be27 candidate
	// (hash of the signageos.io URL) therefore always has n=0.
	'wallclockFixedParWebsite/_0bd0be27': { minOccurrences: 0 },

	// wallclockFixedParWebsite: video-test_0b02adc4 and landscape2 belong to the "should
	// never play" par (past wallclock end date 2011-01-01T23:59:59). The test asserts
	// toHaveCount(0) for these elements — they are never displayed.
	'wallclockFixedParWebsite/video-test_0b02adc4.mp4': { minOccurrences: 0 },
	'wallclockFixedParWebsite/landscape2_2d654451.jpg': { minOccurrences: 0 },

	// wallclockNoActivePar / wallclockNoActiveSeq: no wallclock window is active during the
	// test run, so the par/seq content (video-test, landscape*) never appears. Only the loader
	// video loops as the default fallback. minOccurrences:0 only mutes the registry here —
	// "never plays" is enforced by the tests themselves via toHaveCount(0) on every content
	// element (the monitor cannot assert absence).
	'wallclockNoActivePar/video-test_465b7757.mp4': { minOccurrences: 0 },
	'wallclockNoActivePar/landscape1_fe944bd5.jpg': { minOccurrences: 0 },
	'wallclockNoActivePar/video-test_0b02adc4.mp4': { minOccurrences: 0 },
	'wallclockNoActivePar/landscape2_2d654451.jpg': { minOccurrences: 0 },
	'wallclockNoActiveSeq/video-test_465b7757.mp4': { minOccurrences: 0 },
	'wallclockNoActiveSeq/landscape1_fe944bd5.jpg': { minOccurrences: 0 },
	'wallclockNoActiveSeq/video-test_0b02adc4.mp4': { minOccurrences: 0 },
	'wallclockNoActiveSeq/landscape2_2d654451.jpg': { minOccurrences: 0 },

	// wallclockConditionalSeq: video-test_0b02adc4 and landscape2 are in a par with
	// expr="adapi-weekday()>=9" (inactive conditional — weekday never >=9). These elements
	// never play; the test confirms toHaveCount(0) for video-test_0b02adc4.
	'wallclockConditionalSeq/video-test_0b02adc4.mp4': { minOccurrences: 0 },
	'wallclockConditionalSeq/landscape2_2d654451.jpg': { minOccurrences: 0 },

	// wallclockConditionalPar: the SMIL has 4 regions running in parallel. The visibility
	// monitor can only observe one <video> (main page) and one <img> (frame) at a time —
	// it always returns the first matching visible element. When multiple regions play
	// simultaneously:
	// - video-test_0b02adc4 plays in bottom-right while video-test_465b7757 plays in
	//   top-left; the monitor sees only one video, so video-test_0b02adc4 never gets a
	//   complete cycle (open-ended or not observed).
	// - landscape2 (5s, bottom-right) plays simultaneously with landscape1 (3s, top-left);
	//   the frame monitor finds landscape1 first, then when landscape1 disappears and
	//   landscape2 is still visible, the cycle recorded for landscape2 is far shorter
	//   than 5s. Both candidates cannot be reliably duration-enforced in this layout.
	//   Set expectedSec:0 (record-only) so the duration check is skipped regardless of n.
	'wallclockConditionalPar/video-test_0b02adc4.mp4': { minOccurrences: 0 },
	'wallclockConditionalPar/landscape2_2d654451.jpg': { minOccurrences: 0, expectedSec: 0 },

	// wallclockRepeatCount: the two <video> candidates play in parallel regions (top-left,
	// bottom-right), so the monitor (one <video> at a time) never gets a closing transition
	// for the second → record-only. landscape1 (top-right) is the repeatCount guard: it plays
	// for EXACTLY 2 iterations of dur=3s as one continuous visible period (same src, no
	// inter-iteration transition), then the playlist advances to the landscape2 sentinel,
	// closing landscape1's single ~6s cycle. Enforcing expectedSec=6 (=2×3) makes the monitor
	// fail a wrong repeatCount (e.g. 3 → ~9s cycle, outside ±800ms). landscape2 is the
	// indefinite sentinel (record-only).
	'wallclockRepeatCount/video-test_465b7757.mp4': { minOccurrences: 0 },
	'wallclockRepeatCount/landscape1_fe944bd5.jpg': { expectedSec: 6 },
	'wallclockRepeatCount/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// wallclockFuture: the future-dated wallclock element (video-test_465b7757 then img_1)
	// appears after several loader loops. The test verifies img_1 becomes visible, then
	// ends immediately — the img's visibility span is open-ended so n=0.
	'wallclockFuture/img_1_aba14e1e.jpg': { minOccurrences: 0 },

	// conditionalMediaElement: 4 regions running in parallel (top-left, top-right, bottom-left,
	// bottom-right). landscape1 plays simultaneously in top-left and top-right regions; the frame
	// monitor finds the first-match img, so the second region's img never gets a closing
	// transition → record-only. landscape2 plays simultaneously in bottom-left and bottom-right
	// with the same problem. Both cannot be reliably duration-enforced.
	'conditionalMediaElement/landscape1_fe944bd5.jpg': { minOccurrences: 0, expectedSec: 0 },
	'conditionalMediaElement/landscape2_2d654451.jpg': { minOccurrences: 0, expectedSec: 0 },
	// video-test_0b02adc4 plays simultaneously in bottom-left and bottom-right regions alongside
	// video-test_465b7757 in top-left and top-right. The page monitor sees only one video at a
	// time; with two videos playing in parallel the second never gets a complete observed cycle.
	'conditionalMediaElement/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// cssBottomAndRight: <par> plays video and img_1 simultaneously and indefinitely. The test
	// exits as soon as both become visible and pass coordinate checks — neither element ever
	// transitions away during the test, so both have open-ended visibility spans (n=0).
	'cssBottomAndRight/img_1_aba14e1e.jpg': { minOccurrences: 0 },
	'cssBottomAndRight/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// zonesCypress: multiple regions play simultaneously — topRightWidget (widget_image_1.png),
	// bottomRightWidget (widget_image_2.png), video region (img_1/img_2), plus widget iframes
	// (topOverlay, bottomWidget). The frame monitor returns the first-match visible img; with
	// several imgs visible simultaneously across regions, no candidate gets a clean closing
	// transition. All frame-layer candidates are record-only.
	// widget iframes (.wgt): not observable as img elements at all.
	'zonesCypress/topOverlay_644d01c6.wgt': { minOccurrences: 0 },
	'zonesCypress/bottomWidg_f8c45e2b.wgt': { minOccurrences: 0 },
	// widget images: persistent overlays (always visible alongside other img candidates).
	'zonesCypress/widget_ima_fc4290d1.png': { minOccurrences: 0, expectedSec: 0 },
	'zonesCypress/widget_ima_c6ddb82f.png': { minOccurrences: 0 },
	// img_1/img_2 in video region: coexist with persistent overlay widget images, so
	// monitor never returns them as the sole visible img → no complete cycle recorded.
	'zonesCypress/img_1_aba14e1e.jpg': { minOccurrences: 0 },
	'zonesCypress/img_2_18b5d21f.jpg': { minOccurrences: 0 },
	// adapi blankScreen ref: not an observable img element.
	'zonesCypress/adapi-blan_efcb6b6e': { minOccurrences: 0 },

	// widgetExtensions: all four candidates are widget iframes (.wgt, .zip, .ipk, .apk) —
	// the visibility monitor does not observe nested widget iframes, so n=0 for all.
	'widgetExtensions/bottomWidg_f8c45e2b.wgt': { minOccurrences: 0 },
	'widgetExtensions/bottomWidg_b826826c.zip': { minOccurrences: 0 },
	'widgetExtensions/bottomWidg_b3552afe.ipk': { minOccurrences: 0 },
	'widgetExtensions/bottomWidg_3e7e9d1a.apk': { minOccurrences: 0 },

	// simpleBillboard: the billboard transition renders images as <ol> list elements, not
	// <img> elements. The visibility monitor looks for img[src*="..."] in the applet frame
	// and therefore never observes these candidates (n=0). Record-only.
	'simpleBillboard/landscape1_fe944bd5.jpg': { minOccurrences: 0 },
	'simpleBillboard/landscape2_2d654451.jpg': { minOccurrences: 0 },

	// simpleCrossfade: during a crossfade transition the leaving and entering images are briefly
	// both visible. The leaving element's last recorded cycle may be cut short or extended by
	// the 1s transition overlap. Allow one outlier cycle per candidate.
	'simpleCrossfade/landscape1_fe944bd5.jpg': { maxOutliers: 1 },
	'simpleCrossfade/landscape2_2d654451.jpg': { maxOutliers: 1 },

	// defaultTransition: same crossfade-overlap effect as simpleCrossfade above (the fade
	// comes from <meta defaultTransition> instead of per-element transIn).
	// landscape2 (DOM-second) is SYSTEMATICALLY clipped by the 1s fade: during the
	// overlap the first-match monitor attributes visibility to DOM-first landscape1,
	// so landscape2's observed cycle is dur(3s) - fade(1s) ≈ 2s on every cycle
	// (observed 1921/1939/2056ms across runs — maxOutliers can't absorb a systematic
	// shift). expectedSec:2 is the true first-match-visible duration and still fails
	// if the fade breaks (cycle would read ~3s+). landscape1 keeps 3s with one
	// outlier for its fade-extended closing cycle. simpleCrossfade shares the same
	// physics but typically records n<=1 for landscape2 (trivially passing via the
	// outlier drop); align it the same way if it ever flakes with n>=2.
	'defaultTransition/landscape1_fe944bd5.jpg': { maxOutliers: 1 },
	'defaultTransition/landscape2_2d654451.jpg': { expectedSec: 2, maxOutliers: 1 },

	// conditionalTimePriority: content-do_6db83442.jpeg (5s background) plays from the start
	// but gets cut at the priority window boundary (+30s from SMIL-fetch) — one cut cycle.
	'conditionalTimePriority/content-do_6db83442.jpeg': { maxOutliers: 1 },
	// img_1 and img_2 also cut at the priority/time-condition boundary — one cut each.
	'conditionalTimePriority/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	'conditionalTimePriority/img_2_18b5d21f.jpg': { maxOutliers: 1 },

	// priorityThreeLevelDeferExpiry: img_3 (P2, window -15s to +15s) expires while deferred
	// behind P1 — it never plays; the test verifies this. minOccurrences:0.
	'priorityThreeLevelDeferExpiry/img_3_4ac1868a.jpg': { minOccurrences: 0 },
	// img_1 (P1, window -15s to +30s) cut at +30s boundary — one boundary cut.
	'priorityThreeLevelDeferExpiry/img_1_aba14e1e.jpg': { maxOutliers: 1 },

	// prioritySmilUpdate: SMIL reload clears Phase 1 counters; in Phase 2 img_1 (P_high) is
	// cut when P_high's 15s window expires — one boundary cut per img_1.
	'prioritySmilUpdate/img_1_aba14e1e.jpg': { maxOutliers: 1 },

	// prioritySeqCampaign: the test now proves both rotations via explicit cycle asserts —
	// P_high Campaign A→B→A and P_low Campaign C (img_2 → video-test-2 → img_2) after the
	// +60s window — so a one-pass-then-freeze turns the test RED at the assertion. The
	// P_low elements (img_2, video-test-2) fall back to default enforcement (must appear +
	// duration). We do NOT set minOccurrences:2: the counted element's 2nd appearance is
	// the test's final assert and the 100ms monitor poll races assertDurations (observed
	// ~1/3 false "only 1 appearance" fails); the explicit cycle asserts are the guard.
	// img_1 and img_3 (P_high seq campaign) cut at the wallclock boundary (+60s) — one cut each.
	'prioritySeqCampaign/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	'prioritySeqCampaign/img_3_4ac1868a.jpg': { maxOutliers: 1 },

	// priorityStop: img_1 (P3) cut when P2 stops P3 at +35s — one boundary cut.
	'priorityStop/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	// img_3 (P2) exhibits a very short cycle (~229ms) during the P1→P2 stop handoff at +60s —
	// transient visibility flash from the stop mechanism. One outlier dropped.
	'priorityStop/img_3_4ac1868a.jpg': { maxOutliers: 1 },

	// priorityPause: P2 (higher="pause") interrupts P3 at +35s, pausing it mid-display.
	// img_1 (P3) cut when P2 activates — one boundary cut.
	'priorityPause/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	// img_3 (P2) cut when P1 interrupts P2 at +65s — one boundary cut.
	'priorityPause/img_3_4ac1868a.jpg': { maxOutliers: 1 },

	// priorityOscillation: P_high has two windows (A: -15s to +20s, B: +35s to +50s).
	// img_1 (P_high) cut at Window A end (+20s) and Window B end (+50s) — two boundary cuts.
	'priorityOscillation/img_1_aba14e1e.jpg': { maxOutliers: 2 },
	// img_2 (P_low) cut when Window B activates at +35s and stops P_low — one boundary cut.
	'priorityOscillation/img_2_18b5d21f.jpg': { maxOutliers: 1 },

	// priorityDeferInterrupt: P2 plays immediately (from -2min); P1 arrives at +30s and stops
	// P2 mid-cycle. img_3 (P2) records one very long cycle (~28s) as its last display spans
	// the entire P1-stop boundary — one outlier allowed.
	'priorityDeferInterrupt/img_3_4ac1868a.jpg': { maxOutliers: 1 },
	// img_2 (P3): test ends immediately after seeing img_2 → open-ended span, n=0.
	'priorityDeferInterrupt/img_2_18b5d21f.jpg': { minOccurrences: 0 },
	// video-test_0b02adc4 (P2 video): P1 stops P2 at +30s; video may not complete a clean
	// cycle before the stop — open-ended or never observed. minOccurrences:0.
	'priorityDeferInterrupt/video-test_0b02adc4.mp4': { minOccurrences: 0 },

	// priorityDefer: img_3 (P2, window 0-45s) can produce one extended cycle at the P2→P3
	// transition boundary — the last img_3 span runs until the monitor closes rather than
	// until video-test-2 cleanly appears. One outlier allowed.
	'priorityDefer/img_3_4ac1868a.jpg': { maxOutliers: 1 },
	// img_1 (P1, window 0-20s) cut at P1 boundary (+20s) — one boundary cut.
	'priorityDefer/img_1_aba14e1e.jpg': { maxOutliers: 1 },

	// priorityLowerStop: P_low (img_2, img_3) is blocked by lower="stop"→never remap while
	// P_high (+60s window) is active. The test drives a full post-release cycle (img_2 →
	// img_3 → img_2) via explicit cycle asserts — the forward-progress guard. P_low images
	// use default enforcement (must appear + ~3s duration). No minOccurrences:2: the 2nd
	// img_2 is the final assert and the 100ms monitor poll races assertDurations.
	// img_1 (P_high, window 0-60s) cut at boundary end — one boundary cut.
	'priorityLowerStop/img_1_aba14e1e.jpg': { maxOutliers: 1 },

	// priorityLowerPause: P_low (img_2 → video-test-2) cycle after P_high's +60s window is
	// proven by explicit cycle asserts (img_2 → video-test-2 → img_2) — the forward-progress
	// guard. img_2/video-test-2 use default enforcement (must appear + duration); img_1
	// already passed strict at default. No minOccurrences:2 override — the 2nd img_2 is the
	// final assert and the 100ms monitor poll races assertDurations.

	// priorityNever: P_low (img_3, img_2) is blocked by lower="never" while P_high (+40s
	// window) is active. The test drives a full post-release cycle (img_3 → img_2 → img_3)
	// via explicit cycle asserts — the forward-progress guard — so a release-then-deadlock
	// turns it RED at the assertion. P_low images use default enforcement (must appear +
	// ~3s duration). No minOccurrences:2: the 2nd img_3 is the final assert and the 100ms
	// monitor poll races assertDurations (~1/3 false "only 1 appearance" fails).
	// img_1 (P_high, +40s window) cut at window end — one boundary cut.
	'priorityNever/img_1_aba14e1e.jpg': { maxOutliers: 1 },

	// priorityDeferExpiry: P_low (img_3, img_2) defers behind P_high while its wallclock
	// window 0-25s expires — the test verifies these elements NEVER play. minOccurrences:0.
	'priorityDeferExpiry/img_3_4ac1868a.jpg': { minOccurrences: 0 },
	'priorityDeferExpiry/img_2_18b5d21f.jpg': { minOccurrences: 0 },
	// img_1 (P_high) cut when P_high's window ends at +90s — one possible boundary cut.
	'priorityDeferExpiry/img_1_aba14e1e.jpg': { maxOutliers: 1 },

	// priorityPeerPause: Peer B's wallclock fires at +30s mid-display of Peer A, pausing it;
	// B's window ends at +50s, cutting B's last cycle short. One cut cycle per key.
	'priorityPeerPause/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	'priorityPeerPause/img_2_18b5d21f.jpg': { maxOutliers: 1 },
	'priorityPeerPause/img_3_4ac1868a.jpg': { maxOutliers: 1 },

	// priorityPeerDefer: Peer B (img_3, img_2) defers behind Peer A until +30s.
	// img_1 (Peer A) cut when Peer A's window ends at +30s — one boundary cut.
	'priorityPeerDefer/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	// img_2 is Peer B's second element; the test ends immediately after img_2 becomes
	// visible → open-ended span, no closing transition observed (n=0).
	'priorityPeerDefer/img_2_18b5d21f.jpg': { minOccurrences: 0 },

	// priorityPeerStop: img_3 (Peer B, window 30-60s) exhibits ~500ms cycles due to
	// transient DOM visibility flashes during the peer-stop handoff mechanism — the
	// stop event causes rapid show/hide transitions that the monitor records as very
	// short cycles. Not real playback duration; record-only (expectedSec:0).
	'priorityPeerStop/img_3_4ac1868a.jpg': { minOccurrences: 0, expectedSec: 0 },
	// img_1 (Peer A, window 0-90s) cut when Peer B stops Peer A at +30s — one boundary cut.
	'priorityPeerStop/img_1_aba14e1e.jpg': { maxOutliers: 1 },
	// img_2 (Peer B, window 30-60s): test ends as soon as Peer A's video reappears at +60s;
	// img_2 may be mid-cycle at test end → open-ended span possible (n=0). When the
	// window end DOES close a cycle, that cycle is boundary-clipped (observed
	// ~450-475ms) — one legitimate cut per run, so tolerate a single outlier.
	'priorityPeerStop/img_2_18b5d21f.jpg': { minOccurrences: 0, maxOutliers: 1 },

	// priorityConditionalPhantom: img_1's expr is statically false (adapi-weekday()>=9) —
	// the element must NEVER render; the test asserts not.toBeVisible explicitly.
	'priorityConditionalPhantom/img_1_aba14e1e.jpg': { minOccurrences: 0 },
};
