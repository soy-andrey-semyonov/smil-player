# Media Update Configuration

## Overview

By default the SMIL player checks for media updates using the `Last-Modified` HTTP header on a shared polling
interval. Per-element update attributes let you override this behaviour for individual media files — use a different
update strategy, point update checks at a separate URL, set a custom check interval, or control what happens when the
server is unreachable.

## Update mechanism

The `updateMechanism` attribute is set on the `<meta>` tag and applies to all media in the playlist.

| Value | Behaviour |
|-------|-----------|
| `last-modified` (default) | The player sends a HEAD request and compares the `Last-Modified` header to decide whether to re-download. |
| `location` | The player sends a HEAD request and compares the `Location` header (redirect URL). If the redirect target changes to a different URL path, the file is considered updated. A change in **query parameters only** (e.g. a rotating signed-URL token) is *not* treated as a new version — the comparison ignores the query string, so signed CDN URLs don't trigger pointless re-downloads. Useful when your CDN serves content through redirect URLs that change on each new version. |

```xml
<head>
    <meta http-equiv="Refresh" content="60" updateMechanism="location"/>
</head>
```

## Per-element attributes

These attributes can be placed directly on any media element (`<video>`, `<img>`, `<ref>`).

### updateCheckUrl

Custom URL used for the HEAD update-check request instead of the element's `src`. This is useful when you have a
lightweight endpoint that returns update information without serving the full file.

```xml
<video src="https://cdn.example.com/video.mp4"
       updateCheckUrl="https://api.example.com/check/video.mp4"
       dur="30s" region="main"/>
```

### updateCheckInterval

Per-element refresh interval in seconds. Overrides the global refresh interval defined in the `<meta>` tag for this
specific element. Only applies to interval-based polling — when `checkBeforePlay="true"` is set, media is checked
right before playback instead and this attribute has no effect.

```xml
<img src="https://cdn.example.com/banner.jpg"
     updateCheckInterval="120"
     dur="10s" region="main"/>
```

### allowLocalFallback

When set to `true`, the player keeps playing the cached version of the file if the update-check request fails. When
set to `false`, the element is skipped entirely when the update check fails with a **network/transport error** or a
**5xx server error**. An update check that *times out* (see `<meta timeOut>`) plays from cache in both modes.

Defaults to `true`.

```xml
<video src="https://cdn.example.com/ad.mp4"
       allowLocalFallback="false"
       dur="15s" region="main"/>
```

## Global `<meta>` status-code attributes

Unlike the attributes above, the following two are set on the `<meta>` tag in the SMIL `<head>` and apply to all media
in the playlist.

### skipContentOnHttpStatus

Comma-separated list of HTTP status codes. If the update-check HEAD request returns one of these status codes, the
element is skipped and will not be played. The element recovers automatically once its URL serves content again.

Only 4xx codes work here — **5xx server errors are handled before this list is consulted** (cached copy plays, or the
element is skipped when it sets `allowLocalFallback="false"`), so listing 500/503 has no effect.

```xml
<head>
    <meta http-equiv="Refresh" content="60" skipContentOnHttpStatus="404"/>
</head>
```

### updateContentOnHttpStatus

Comma-separated list of HTTP status codes. If the update-check HEAD request returns one of these status codes, the
player forces a re-download of the file regardless of whether headers indicate a change.

**Never list `200` here** — a healthy server answers `200` to every routine check, which would force a full re-download
of every media file on every refresh interval. Use a code your server returns *only* when it deliberately wants to
force a refresh (e.g. `226`).

```xml
<head>
    <meta http-equiv="Refresh" content="60" updateContentOnHttpStatus="226"/>
</head>
```

## playCheckUrl (playability gate)

A second per-element URL whose **sole** job is deciding whether the element plays. Right before each play, the player
sends a HEAD request to `playCheckUrl`; if the response status is listed in `<meta skipPlaybackOnHttpStatus>`, the
element is skipped **for this pass only**. Everything else about the element is untouched — downloads, caching, update
checks (`src`/`updateCheckUrl`), and version detection run exactly as without the attribute.

```xml
<head>
    <meta http-equiv="Refresh" content="60" skipPlaybackOnHttpStatus="403,404,410"/>
</head>
...
<video src="https://cdn.example.com/campaign.mp4"
       playCheckUrl="https://api.example.com/play-check/campaign"
       dur="30s" region="main"/>
```

**`<meta skipPlaybackOnHttpStatus>` is required** — without it (or with an empty value) the gate is inert: the element
always plays, no gate request is sent, and the player logs a one-time debug warning. Non-numeric entries in the list
are ignored; if no valid status code remains (e.g. `"404;500"` — wrong separator), the gate is inert as above. The
list is read **only** by the
gate and is fully independent of `skipContentOnHttpStatus`: a gate status never marks content `skipContent`, and the
update-check channel never consults the gate list. This keeps, for example, a CDN 403 on `src` (expired signed URL)
from being confused with a deliberate "not entitled" gate answer.

Behaviour summary:

- **Skip is per-pass, recovery is automatic.** The gate is re-checked before every play; the moment the server answers
  with an unlisted status again, the element plays. No persistent skip state is kept.
- **Fail-open.** Network error, timeout, or CORS failure → the element plays from cache. An HTTP status *not* in the
  list — including 5xx — also plays. (Consequence: a status you *do* list always skips, even 503 — don't list 5xx.)
- **Activates on its own.** The attribute works with or without `checkBeforePlay`. With `checkBeforePlay` +
  `checkAheadCount`, updates ride the lookahead while the gate still fires inline right before play — two independent
  HEAD channels. Expect the gate to add roughly one round-trip before each gated play.
- **Must be an absolute URL.** A relative `playCheckUrl` is *not* resolved against the SMIL file (unlike `src`); it
  would resolve against the player's own origin and silently misbehave — fail-open on some platforms, or gate against
  an unrelated endpoint's status on others.
- **Timeout is shared with the update checks.** The gate HEAD uses the `<meta timeOut>` value (default 2000 ms). A
  hanging gate endpoint therefore stalls each gated play in that region for up to the full timeout before
  fail-opening — keep the gate endpoint fast, and keep `timeOut` low if you raise it for slow update origins.
- **Applies to** `<video>`, `<img>`, `<ref>`, tickers, and streams. Intro media is not gated.
- **Redirects resolve transparently** — the *final* status after redirects is classified; listing 3xx has no effect.
- **CORS required.** The gate request is a browser XHR: the gate endpoint must send
  `Access-Control-Allow-Origin` (and allow `HEAD`). A gate endpoint without CORS fails at the network layer and
  fail-opens — the gate silently never gates, and the only symptom is a debug-log network error.
- **Sync groups.** Each device queries the gate independently. Keeping devices in a sync group consistent is the gate
  server's contract: it must answer the same for all devices of a group; the player does not reconcile diverging
  answers. Note that consistent *answers* are necessary but not sufficient — a transport failure on one device
  (timeout → fail-open → plays) while another gets a listed status (skips) also diverges the decisions. A slow or
  flapping gate endpoint therefore causes periodic desync churn that the sync engine has to recover from via resync;
  gate endpoints serving sync groups must be fast and reliable, not just consistent.
- **No proof-of-play** is emitted for a gate-skipped pass, and `playCheckUrl` never appears in report payloads.
- **Priority interplay — do not rely on lower-priority fallback rotation.** A gate-closed element inside a higher
  `priorityClass` releases its priority slot on every skipped pass (no deadlock), but each pass still contends for the
  region before the gate answer arrives and interrupts the lower class with the `higher` rule. In practice the lower
  playlist paints at most its first element and the region then stays frozen on the last painted content until the
  gate reopens — and if the gate is closed from the very start of playback, the region can stay empty. Schedule gated
  content with `wallclock` windows (or gate all peers consistently) instead of expecting a lower `priorityClass` to
  rotate behind a long-closed gate.

**Recommended status contract:** `skipPlaybackOnHttpStatus="403,404,410"` (minimally `"404"`). Serve **200** (or 204)
to play; **404** = no content for this slot, **410** = campaign ended, **403** = device not entitled. These are
origin-generated 4xx codes that intermediaries don't fabricate. Avoid listing **5xx** (an infrastructure outage would
masquerade as a gate decision and defeat fail-open), **3xx** (redirects resolve before classification), and **401**
(auth layers emit it on their own; use 403 for deliberate denial).

## Which URL appears in reports (`useInReportUrl`)

`useInReportUrl` is an internal field the player maintains for each media element: during every update check it stores
the **final URL after redirects** (the `Location` target when `updateMechanism="location"` is used), and reports use
that value instead of the raw `src`. This happens automatically — reports for redirected content always show the real
final URL.

Because the player overwrites this field on every update check, setting `useInReportUrl` manually in the SMIL only has
an effect for elements that are never update-checked: **streams** and live-website `<ref>` elements. For all normal
downloaded media, treat it as a reporting output, not an authorable attribute. See
[Custom Endpoint Reporting](../reporting/custom-endpoint.md) for how it appears in payloads.

## Full SMIL example

```xml
<smil>
    <head>
        <meta http-equiv="Refresh" content="60"
              updateMechanism="location"
              skipContentOnHttpStatus="404"
              skipPlaybackOnHttpStatus="403,404,410"
              updateContentOnHttpStatus="226"/>

        <layout>
            <root-layout width="1920" height="1080"/>
            <region regionName="main" left="0" top="0" width="1920" height="1080" z-index="1"/>
        </layout>
    </head>
    <body>
        <par>
            <seq repeatCount="indefinite">
                <!-- Check a separate URL for updates, skip if server is down -->
                <video src="https://cdn.example.com/promo.mp4"
                       updateCheckUrl="https://api.example.com/check/promo"
                       allowLocalFallback="false"
                       dur="30s" region="main"/>

                <!-- Use default update checks, fall back to cache if offline -->
                <img src="https://cdn.example.com/banner.jpg"
                     allowLocalFallback="true"
                     dur="10s" region="main"/>

                <!-- Custom check interval for this element only -->
                <video src="https://cdn.example.com/news.mp4"
                       updateCheckInterval="300"
                       dur="60s" region="main"/>

                <!-- Playability gate: plays only while the gate URL answers with an
                     unlisted status (requires skipPlaybackOnHttpStatus on the meta) -->
                <img src="https://cdn.example.com/campaign-banner.jpg"
                     playCheckUrl="https://api.example.com/play-check/campaign-banner"
                     dur="10s" region="main"/>
            </seq>
        </par>
    </body>
</smil>
```

## See also

- [Updating SMIL Playlist](updating-smil-playlist.md) — global refresh intervals and playlist-level update settings
- [Check Before Play](check-before-play.md) — check each media file for updates right before playback

Source: [a-smil.org](https://www.a-smil.org/index.php/Main_Page)
