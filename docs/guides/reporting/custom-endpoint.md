# SMIL Custom endpoint reporting

The SMIL player has an option to enable logging of major events occurring during the playlist lifecycle.
The advantage of this feature is that it allows you to track your content's usage and status, and
the SMIL player will report with
custom attributes that you can define in your SMIL playlist.

When a custom endpoint is specified, the SMIL player sends all reports to this endpoint, where you can process them
according
to your needs. Reports are sent as POST requests with the body specified as an array of reports.

## Request example

```javascript
fetch("https://stage.customEndpoint.com/api/webhooks/device-proof-of-play/cm0w686jl009si1l4jcxhhiey/proof-of-play-event", {
	"headers": {
		"content-type": "application/json",
	},
	"body": "[{\"name\":\"media-playback\",\"playbackSuccess\":true,\"type\":\"video\",\"tags\":[\"ckr1u68ig890351znnshenikir\",\"cm0w686jl009si1l4jcxhhiey\",\"cm34j6ldy0035ib6ryzevjwsi\",\"https://cdn.example.com/video.mp4\"],\"status\":200,\"time\":1732146902,\"url\":\"https://cdn.example.com/video.mp4\"}]",
	"method": "POST"
});
```

## Offline storage and retries

Whenever a POST to the endpoint fails — the device is offline, or the endpoint answers with a non-2xx status — the
report is saved to local storage instead of being lost. Stored reports are uploaded in bulk (up to 100 reports per
file) on the next reporting pass once the endpoint is reachable again. Reports that were re-uploaded from offline
storage carry an extra field so you can distinguish them from live reports:

```json
{ "name": "media-playback", "...": "...", "isOfflineReport": true }
```

## Setup

To enable logging, you must specify a `<meta>` tag with a log value in the SMIL header.

```xml

<meta log="true" type="manual" endpoint="customUrlEndpoint"/>
```

It's also possible to specify multiple logging types at the same time:

```xml

<meta log="true" type="manual,standard" endpoint="testingEndpoint"/>
```

`type="manual"` selects proof-of-play reporting, `type="standard"` selects the
[standard event reporting](event-reporting.md); listing both runs both. Unknown types are ignored, and when `type` is
omitted entirely, `standard` is used.

Alternatively, the endpoint can be set device-side with the `reportUrl` applet configuration option. When set, it
overrides the `endpoint` from the SMIL `<meta>`, force-enables reporting, and *adds* the proof-of-play type to whatever
types the SMIL configures. See [SMIL Player Configuration](../tutorials/smil-player-configuration.md).

> Note: `log="false"` disables the standard and native proof-of-play transports, but custom-endpoint POSTs are
> controlled by the presence of the `endpoint` (or `reportUrl` config) — remove the endpoint if you want them to stop.

### PoP attributes for each element you want reports for in smil playlist

All `pop*` attributes are optional — a report is sent for every media element whenever proof-of-play logging
(`type="manual"`) is active. Attributes you set are included in the report; attributes you omit are left out of the
payload entirely. The `popTags` attribute allows you to specify multiple tags separated by commas, which will be sent
as an array in the report — the player appends the content's final URL as the last array entry.

Note the report's `name` field is set by the player itself (`media-playback`, `media-download`, `playlist-download`,
`playlist-playback`) and identifies the event type — the `popName` attribute value is not carried in custom-endpoint
payloads. Use `popCustomId` or `popFileName` to identify individual media items.

```xml

<img src="srcToElement"
     dur="15s"
     region="region"
     popType="video"
     popCustomId="customId"
     popFileName="First video"
     popTags="tag1,tag2,tag3"/>
```

## Report Mode

By default, reports are sent immediately via HTTP POST as each media event occurs. The `reportMode` attribute lets you override this on a per-element basis, choosing between immediate delivery and batched offline storage.

### Values

- **`immediate`** (default) — Reports are sent via HTTP POST to the configured endpoint as they occur. This is the default behavior when `reportMode` is omitted.
- **`batch`** — Playback reports are saved to local CSV storage and uploaded in bulk. This reduces network traffic and is useful for high-frequency playlists or unreliable connections.

`reportMode` applies to **playback** reports only; download reports are always sent immediately.

### Usage

Add the `reportMode` attribute directly to any media element in your SMIL playlist. You can mix modes within the same playlist:

```xml
<seq>
    <!-- This video's playback reports are batched to CSV and uploaded in bulk -->
    <video src="https://example.com/video.mp4"
           region="main"
           popName="promo-video"
           reportMode="batch"/>

    <!-- This image's reports are sent immediately (explicit) -->
    <img src="https://example.com/banner.jpg"
         dur="10s"
         region="main"
         popName="banner"
         reportMode="immediate"/>

    <!-- This image's reports are also sent immediately (default when omitted) -->
    <img src="https://example.com/logo.jpg"
         dur="5s"
         region="main"
         popName="logo"/>
</seq>
```

### Batch file limit and upload timing

When using `reportMode="batch"`, the `reportFileLimit` attribute on the `<meta>` tag controls how many reports are stored per batch file before a new file is created. The default is 100.

```xml
<meta log="true" type="manual" endpoint="https://example.com/reports" reportFileLimit="50"/>
```

The upload watcher runs every 10 minutes, but a file holding only batched reports is uploaded once it **reaches the
`reportFileLimit`** (or after a player restart) — not merely because 10 minutes passed. Files that also contain
failed-send reports are uploaded on the next watcher pass regardless of fill level.

## URL Redirect Handling

When content URLs redirect (e.g., through a CDN or load balancer), the SMIL player automatically captures the final URL after all redirects. This final URL is used in all proof-of-play reports.

### How It Works

1. When checking for updates, the player sends a HEAD request to the content URL
2. If the server responds with a redirect (Location header) or the response URL differs from the request URL, the player captures the final URL
3. This final URL is included in all PoP reports for that content

### Benefits

- **Accurate Reporting**: Reports reflect the actual URL where content was served from
- **CDN Tracking**: Track which CDN edge served the content
- **Dynamic Content**: Handle URLs that redirect based on device location or other factors

### Example

If your SMIL contains:
```xml
<video src="https://content.example.com/video.mp4" popName="promo" .../>
```

And the CDN redirects to `https://cdn-edge-1.example.com/video.mp4`, the PoP report will include the final CDN URL in the `url` field (and as the last entry of the `tags` array), giving you visibility into actual content delivery paths.

## Logged events

- Each real file download (`media-download`) — internal copy/restore operations are not reported
- Each media playback (`media-playback`)
- Each download of the SMIL file itself (`playlist-download`)
- Each (re)start of SMIL playlist processing (`playlist-playback`)

## Payload of messages

All custom endpoint reports include a `status` field containing the HTTP status code and a `time` field with a Unix
timestamp in **seconds**. The `url` field contains the content URL used for the report (the final URL after
redirects). The `customId`, `type`, `fileName` and `tags` fields appear only when the corresponding `pop*` attribute
is set on the element.

**How to detect failures:** check the `status` field. Playback failures are reported with `status: 500`; download
failures carry the HTTP error status of the failed request (or `502` when the download itself threw). The
`playbackSuccess` field is currently always `true` and should not be used for failure detection.

### Download (`media-download`)

```json
{
  "name": "media-download",
  "playbackSuccess": true,
  "customId": "customId",
  "type": "video",
  "tags": [
    "tag1",
    "tag2",
    "https://cdn.example.com/video.mp4"
  ],
  "fileName": "video.mp4",
  "status": 200,
  "time": 1732060768,
  "url": "https://cdn.example.com/video.mp4"
}
```

A failed download has the same shape with the error status in `status` (e.g. `502`).

### Playback (`media-playback`)

```json
{
  "name": "media-playback",
  "playbackSuccess": true,
  "customId": "customId",
  "type": "image",
  "tags": [
    "tag1",
    "tag2",
    "https://cdn.example.com/image.jpg"
  ],
  "fileName": "banner.jpg",
  "status": 200,
  "time": 1732060768,
  "url": "https://cdn.example.com/image.jpg"
}
```

A failed playback has the same shape with `"status": 500`.

### Playlist records

The SMIL file itself produces two record types (minimal shape — the SMIL element carries no `pop*` attributes):

```json
{ "name": "playlist-download", "playbackSuccess": true, "status": 200, "time": 1732060768, "url": "https://example.com/playlist.smil" }
```

```json
{ "name": "playlist-playback", "status": 200, "time": 1732060768, "url": "https://example.com/playlist.smil" }
```

`playlist-playback` is sent each time the player starts (or restarts) processing the playlist; a `status` of `902`
indicates the SMIL file could not be parsed.
