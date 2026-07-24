# SMIL events reporting

SMIL player has the option to turn on logging of major events which are happening during playlist lifecycle.
To turn logs on, you have to specify `<meta>` tag with log value in the SMIL header.

```xml

<head>
    <meta log="true" type="standard"/>
</head>
```

It's also possible to specify multiple logging types at the same time:

```xml

<meta log="true" type="manual,standard" endpoint="testingEndpoint"/>
```

`type="standard"` selects the event reports described on this page; `type="manual"` selects
[proof-of-play reporting](proof-of-play.md). When `type` is omitted, `standard` is used; unknown values are ignored.

## Logged events

- each real file download successful or unsuccessful (`SMIL.FileDownloaded`) — internal copy/restore operations are
  not reported
- each media playback successful or unsuccessful (`SMIL.MediaPlayed`; media playing in a synchronized region reports
  as `SMIL.MediaPlayed-Synced`)
- each (re)start of SMIL playlist processing (`SMIL.PlaybackStarted`)
- some major errors ( trigger initialization, sensors etc...) (`SMIL.Error`)

## Payload of messages

### Download

When a download fails, `errorMessage` contains the HTTP status code of the failed request (e.g., `"HTTP 502"`). On
success, `errorMessage` is `null`. The `itemType` field identifies the media category: `image`, `video`, `ref`
(widget/website), `ticker`, or `smil` (the playlist file itself).

#### Success

```json
{
  "type": "SMIL.FileDownloaded",
  "itemType": "image",
  "source": {
    "filePath": {
      "path": "smil/images/img_5_37da4499.jpg",
      "storage": "internal"
    },
    "uri": "https://demo.signageos.io/smil/zones/files/img_5.jpg",
    "localUri": "smil/images/img_5_37da4499.jpg"
  },
  "startedAt": "2024-11-19T21:18:28.781Z",
  "succeededAt": "2024-11-19T21:18:29.483Z",
  "failedAt": null,
  "errorMessage": null
}
```

#### Fail

```json
{
  "type": "SMIL.FileDownloaded",
  "itemType": "image",
  "source": {
    "filePath": {
      "path": "smil/images/img_5_37da4499.jpg",
      "storage": "internal"
    },
    "uri": "https://demo.signageos.io/smil/zones/files/img_5.jpg",
    "localUri": "smil/images/img_5_37da4499.jpg"
  },
  "startedAt": "2024-11-19T21:18:28.781Z",
  "succeededAt": null,
  "failedAt": "2024-11-19T21:18:29.483Z",
  "errorMessage": "HTTP 502"
}
```

### Playback

#### Success

```json
{
  "type": "SMIL.MediaPlayed",
  "itemType": "image",
  "source": {
    "filePath": {
      "path": "http://localhost:8090/indexed_db/218603c29e5e7275a238c43a1422a9b19188752893c12c5128//internal/smil/images/img_4_762d1382.jpg",
      "storage": ""
    },
    "uri": "http://localhost:8090/indexed_db/218603c29e5e7275a238c43a1422a9b19188752893c12c5128//internal/smil/images/img_4_762d1382.jpg?__smil_version=310446_0",
    "localUri": "http://localhost:8090/indexed_db/218603c29e5e7275a238c43a1422a9b19188752893c12c5128//internal/smil/images/img_4_762d1382.jpg"
  },
  "startedAt": "2024-11-19T21:18:36.342Z",
  "endedAt": "2024-11-19T21:18:41.357Z",
  "failedAt": null,
  "errorMessage": null
}
```

#### Fail

```json
{
  "type": "SMIL.MediaPlayed",
  "itemType": "video",
  "source": {
    "filePath": {
      "path": "http://localhost:8090/indexed_db/218603c29e5e7275a238c43a1422a9b19188752893c12c5128//internal/smil/images/img_4_762d1382.jpg",
      "storage": ""
    },
    "uri": "http://localhost:8090/indexed_db/218603c29e5e7275a238c43a1422a9b19188752893c12c5128//internal/smil/images/img_4_762d1382.jpg?__smil_version=310446_0",
    "localUri": "http://localhost:8090/indexed_db/218603c29e5e7275a238c43a1422a9b19188752893c12c5128//internal/smil/images/img_4_762d1382.jpg"
  },
  "startedAt": "2024-11-19T21:18:36.342Z",
  "endedAt": null,
  "failedAt": "2024-11-19T21:18:41.357Z",
  "errorMessage": "HTTP 500"
}
```

Playback failures always carry `errorMessage: "HTTP 500"` — free-text error descriptions are not emitted.

### General error

```json
{
  "type": "SMIL.Error",
  "failedAt": "2024-11-19T21:18:31.996Z",
  "errorMessage": "No sensors specified for nexmosphere triggers: []"
}
```

## How to retrieve logs from api

You need to make `GET` request on endpoint

```xml
/v1/device/{{deviceUid}}/applet/{{appletUid}}/command
```
