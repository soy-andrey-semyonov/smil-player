# IPTV/Video Streaming

With signageOS SMIL Player you can play video streams with various formats if those are [supported by the device you are using](https://docs.signageos.io/hc/en-us/articles/4405387483026).

## Basic usage

For signageOS SMIL Player to correctly recognize streams, it is necessary to include `isStream="true"` in video tag.

> **Warning:** the mere *presence* of the `isStream` attribute marks the element as a stream — `isStream="false"` is
> also treated as a stream. Remove the attribute entirely for regular video files.

It is possible to specify the duration of the stream in the same way as any other media in SMIL by specifying `dur` attribute.

If no `dur` attribute is specified, the stream will play indefinitely (until the stream disconnects or errors, at
which point the playlist moves on).

The streaming protocol is derived automatically from the URL scheme — there is no attribute to set it. Streams are
played live from the network; they are never downloaded, cached, or update-checked.

**Supported formats:**

- UDP (mpeg2-ts)
- RTP
- RTSP
- HLS
- HTTP
- RTMP

```xml
<video src="udp://{ip}/{endpoint}" isStream="true" />
<video src="rtp://{ip}/{endpoint}" isStream="true" />
<video src="rtsp://{ip}/{endpoint}" isStream="true" />
<video src="hls://{ip}/{endpoint}" isStream="true" />
<video src="http://{ip}/{endpoint}" isStream="true" dur="10" />
```
