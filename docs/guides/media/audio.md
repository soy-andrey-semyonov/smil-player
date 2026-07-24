# Audio

> The `<audio>` tag is **not supported** by signageOS SMIL Player. Audio elements are parsed and their files are
> downloaded into storage, but they are never played — playback silently skips them. Avoid `<audio>` elements in
> production playlists; their files only consume bandwidth and device storage.

```xml
<audio src="music.mp3" />
```

### Sound Volume Control

> The `soundLevel` attribute is **not implemented** — it has no effect on playback volume for any media type.

```xml
<video src="ad1.mp4" soundLevel="20%" />
```
