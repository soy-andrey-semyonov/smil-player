# SMIL Proof of Play

SMIL player has the option to turn on logging of major events which are happening during the playlist lifecycle.

The advantage of this feature is that you can track what is happening with your content, how it is being used, and
gather proof-of-play data for reporting and billing purposes.

## Setup

To turn logs on, you have to specify `<meta>` tag with log value in smil header.

```xml

<head>
    <meta log="true" type="manual"/>
</head>
```

### PoP attributes

All PoP attributes are optional — when proof-of-play logging is enabled, a report is generated for every media
element. Attributes you set are included in the payload; attributes you omit are left out entirely.

- `popType` — type label included in the report (`"video"`, `"image"`, `"html"`, or `"custom"`).
- `popCustomId` — custom identifier passed through to the report as `customId`.
- `popFileName` — file name included in the report.
- `popTags` — comma-separated list of tags. Sent as an array in the report payload.

The report's `name` field is set by the player to the event type (`media-playback`, `media-download`,
`playlist-download`) — the `popName` attribute value itself is not carried in the payload, so use `popCustomId` or
`popFileName` to identify individual media items.

```xml

<img src="srcToElement"
     dur="15s"
     region="region"
     popType="video"
     popCustomId="customId"
     popFileName="First video"
     popTags="tag1,tag2,tag3"/>
```

## Logged events

- each file download successful/unsuccessful
- each media playback successful/unsuccessful

## Payload of messages

PoP reports contain the fields derived from the `pop*` attributes on each media element. The `tags` array includes
the `popTags` values followed by the content's final URL and an ISO timestamp.

> **Note:** when a `<meta endpoint>` or the `reportUrl` applet config is set, `type="manual"` reports are POSTed to
> that custom endpoint instead, with an extended payload that includes HTTP `status`, epoch `time`, and `url` fields —
> see [Custom Endpoint Reporting](custom-endpoint.md). The examples below show the native signageOS PoP payload used
> when no custom endpoint is configured.

### Download

```json
{
  "name": "media-download",
  "playbackSuccess": true,
  "customId": "customId",
  "type": "video",
  "tags": [
    "tag1",
    "tag2",
    "https://cdn.example.com/video.mp4",
    "2024-11-19T21:59:28.977Z"
  ],
  "fileName": "video.mp4"
}
```

### Playback

```json
{
  "name": "media-playback",
  "playbackSuccess": true,
  "customId": "customId",
  "type": "image",
  "tags": [
    "tag1",
    "tag2",
    "https://cdn.example.com/image.jpg",
    "2024-11-19T21:48:08.633Z"
  ],
  "fileName": "banner.jpg"
}
```

## How to retrieve the reports

Native PoP reports are delivered through the signageOS proof-of-play pipeline and retrieved via the signageOS
reporting APIs / Box. (The `/v1/device/{{deviceUid}}/applet/{{appletUid}}/command` endpoint retrieves
[standard event reports](event-reporting.md), not PoP reports.)
