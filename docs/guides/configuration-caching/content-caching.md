# Content Caching

signageOS SMIL Player automatically caches SMIL files, all media, and widgets into the internal memory of the device to
allow playback in case there is no network connection.

## How are media handled after a device reboot? Are they re-downloaded?

The content is stored in persistent storage on the device. The SMIL Player downloads files only once (in the first SMIL
file load), then all media files and widgets are stored and available even after the device reboot.

Note: the media cache is keyed to the SMIL URL. If the configured `smilUrl` changes, the cache is invalidated and all
media is re-checked/re-downloaded from scratch.

## What happens if some content is not played anymore (SMIL changed)? Is it deleted from disk immediately?

If any media files or widgets are no longer needed they are deleted once:

- the SMIL Player reboots
- the SMIL file changes
- a new SMIL file is added
- the current SMIL file gets some media/content updated

Before deletion, recently replaced content is first moved into an internal preservation area (up to 20 files per media
type, oldest evicted first). If the same content URL later reappears in the playlist, the file is restored from there
instead of being re-downloaded.

## Is there an automatic file/cache-cleanup implemented in the device?

Any changes implemented in the SMIL file or when the new content is added, all files which are no longer needed are
removed.

## Storage limits

The player enforces a minimum free-space floor of **100 MB** (plus a 10% safety margin) on every download and internal
copy. When an operation would drop free space below the floor, it is skipped and the element keeps its previous content
(or plays nothing if it was never downloaded). If content unexpectedly fails to update on a device, check the free
storage first.

## How to control update mechanisms?

### Separate Update Intervals

The SMIL Player supports independent update intervals for media files and the SMIL file itself:

```xml
<!-- Check media files every 60 seconds, SMIL file every 20 minutes -->
<meta http-equiv="Refresh" contentRefresh="60" smilFileRefresh="1200"/>
```

This separation allows:
- **Efficient bandwidth usage**: SMIL files typically change less frequently than media
- **Optimized performance**: Reduce unnecessary HEAD requests for stable playlist structures
- **Flexible strategies**: Different update frequencies for content vs playlist configuration

**Default behavior:**
- Media files: Use `contentRefresh` or `content` attribute value (default: 20 seconds when neither is set)
- SMIL file: Uses the same interval as media files by default; use `smilFileRefresh` to set a different one

### Disable Media Update Checks

If you want to turn off head requests which monitor if some media files was updated, you can specify in your smil file
`onlySmilUpdate` attribute in refresh `<meta>` tag in smil header.

```xml

<meta http-equiv="Refresh" content="10" onlySmilUpdate="true"/>
```

This xml above means, that SMIL player will check for updates only original smil file and not all media which are
specified within the smil file. Smil player will check for smil file changes each 10 seconds.

If `onlySmilUpdate` is missing, the default value is false, which means the SMIL player will check all media
files for updates.

## Configuring Update Check Timeout

You can configure the timeout for HEAD requests that check for file updates using the `timeOut` attribute:

```xml
<meta http-equiv="Refresh" content="60" timeOut="5000" onlySmilUpdate="false"/>
```

- `timeOut` - Timeout in milliseconds for HEAD requests (default: 2000ms)
- This timeout applies to all update checks (SMIL file and media files)
- For slower or unstable networks, consider increasing the timeout to 5000-10000ms
- The timeout prevents the player from waiting too long when checking for updates on slow connections

## Handling Content Updates and Errors

The SMIL Player provides comprehensive content management through HTTP status codes.

### Automatic Content Skipping

Configure the player to skip content based on HTTP status codes:

```xml
<meta http-equiv="Refresh" content="60" skipContentOnHttpStatus="404"/>
```

With this configuration:
- When a media file returns HTTP 404 (Not Found), it will be automatically skipped
- The playlist continues with the next available content
- No black screens or playback interruption occurs

Only 4xx codes (e.g. 403, 404, 410) can be listed here. **5xx server errors are handled separately before this list is
consulted**, so listing 500/503 has no effect — for 5xx errors the player plays the cached copy, unless the element
sets `allowLocalFallback="false"` (which then skips it on *any* 5xx).

### Forced Content Updates

The `updateContentOnHttpStatus` attribute provides an additional update trigger mechanism alongside last-modified headers:

```xml
<!-- Force re-download when the server signals an update with a dedicated status code -->
<meta http-equiv="Refresh" content="60" updateContentOnHttpStatus="226"/>
```

**Never list `200` (or any code your server returns on every ordinary check) here.** A healthy origin answers `200` to
every update check, so listing it forces a full re-download of every media file on every refresh interval, forever —
burning bandwidth and device storage. Use a distinctive out-of-band code (such as `226 IM Used`) that your server
returns only when it wants to force a refresh. As with the skip list, 5xx codes have no effect here.

How update detection works:
1. **Primary mechanism**: The `Last-Modified` header is compared against the previously stored value. Any change triggers a re-download — not just newer timestamps, but also rollbacks to older versions. If the server does not send a `Last-Modified` header, the file is treated as unchanged to avoid false re-downloads.
2. **Additional mechanism**: Status codes can force updates
3. When a configured status code is returned, content is re-downloaded regardless of `Last-Modified`

This dual mechanism ensures:
- Standard HTTP caching works normally with last-modified headers
- Servers can force updates using status codes when needed
- Dynamic content providers have flexibility in signaling updates

### Comprehensive Content Management

Combine both attributes for complete control:

```xml
<meta http-equiv="Refresh" content="60" 
      skipContentOnHttpStatus="403,404"
      updateContentOnHttpStatus="226"/>
```

Common status codes:
- **Skip codes** (4xx only — 5xx entries are ignored, see above):
  - 404 - Not Found
  - 403 - Forbidden
  - 410 - Gone
- **Update codes** (must be a code the server returns *only* when forcing a refresh):
  - 226 - IM Used (recommended out-of-band signal)
  - 205 - Reset Content (explicit refresh request)

This is particularly useful for:
- Dynamic content feeds with varying availability
- CDN environments with custom status codes
- APIs that signal updates through HTTP status
- Servers that don't properly set last-modified headers

## Per-Media Update Control

For fine-grained control over update behavior, you can add attributes directly to individual media elements (`<img>`, `<video>`, `<ref>`):

### Available Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `updateCheckUrl` | string | same as `src` | Alternative URL for checking updates |
| `updateCheckInterval` | number | from meta tag | Custom update interval in seconds |
| `allowLocalFallback` | boolean | true | Use cached content when server errors occur |
| `playCheckUrl` | string | none | Playability gate: HEAD before each play; skips the pass when the status is listed in `<meta skipPlaybackOnHttpStatus>` (required). No effect on downloads/updates. See [Media Update Configuration](media-update-configuration.md#playcheckurl-playability-gate) |

### Example Usage

```xml
<img dur="5s"
     src="https://cdn.example.com/content/banner.jpg"
     updateCheckUrl="https://api.example.com/check/banner"
     updateCheckInterval="30"
     allowLocalFallback="true"
     region="main" fit="fill"/>
```

### Use Cases

**updateCheckUrl**
- Content served from CDN but update checks go to origin server
- API endpoints that return update status for content
- Separate update monitoring infrastructure from content delivery

**updateCheckInterval**
- Critical content that needs frequent updates (e.g., live data)
- Static content that rarely changes (reduce server load)
- Different update frequencies for different content within the same playlist

**allowLocalFallback**
- Set to `false` to skip content when the update check fails with a network error or a 5xx server error
- Set to `true` (default) to play cached version during connectivity issues
- Useful for time-sensitive content that shouldn't display outdated versions when stale
- Note: an update check that *times out* (see `timeOut`) always plays from cache, even with
  `allowLocalFallback="false"`

## URLs with Query Parameters

The SMIL Player treats URLs with different query parameters as separate files for caching purposes. This means that each unique combination of URL and query parameters will be cached independently.

### How it works

When the SMIL Player encounters URLs with query parameters, it includes those parameters in the cache file naming. This ensures that:
- Different content variations can be served using the same base URL
- Each variation is cached separately
- Query parameters can be used for tracking, versioning, or dynamic content selection

### Important Note on XML Encoding

When using query parameters in SMIL files, remember to properly XML-encode the ampersand character:
- Use `&amp;` instead of `&` between query parameters

### Example Usage

```xml
<!-- These URLs will be cached as separate files -->
<video src="https://example.com/content?adunit=ABC123&amp;id=1" region="main"></video>
<video src="https://example.com/content?adunit=ABC123&amp;id=2" region="main"></video>

<!-- Using query parameters for versioning -->
<img src="https://example.com/banner.jpg?version=2.1&amp;campaign=summer" dur="5s" region="main"></img>

<!-- Dynamic content based on parameters -->
<ref src="https://example.com/widget?location=NYC&amp;lang=en" type="text/html" dur="10s" region="main"></ref>
```

### Common Use Cases

1. **Content Variations**: Serve different content using the same base URL with different parameters
2. **Analytics Tracking**: Add tracking parameters to monitor content performance
3. **A/B Testing**: Use parameters to serve different versions for testing
4. **Dynamic Content**: Pass contextual information through query parameters

## `<prefetch>` (legacy compatibility)

> The section below is to maintain compatibility with the legacy SMIL systems.

**signageOS SMIL Player automatically caches** all files referenced by playable elements in the SMIL playlist
(`<video>`, `<img>`, `<ref>`, `<audio>`) into internal memory and deletes old files which are no longer needed. You do
not have to — and cannot — prefetch files via the `prefetch` tag.

The `<prefetch>` tag itself is accepted for compatibility with legacy SMIL playlists but is **ignored**: a file
referenced *only* by a `<prefetch>` tag is never downloaded. All caching is driven by the playable elements in the
playlist.

The related legacy pattern that **is** supported is the intro/preloader gate: a `<seq end="__prefetchEnd.endEvent">`
block plays a loader until all playlist media has been downloaded, after which the main
`<par begin="__prefetchEnd.endEvent">` content starts. See the
[Hello World tutorial](../tutorials/hello-world-playlist.md) for a complete example.

```xml
<par>
    <!-- Preloader: plays until all media referenced by the playlist is cached -->
    <seq end="__prefetchEnd.endEvent">
        <seq repeatCount="indefinite">
            <video src="https://demo.signageos.io/smil/zones/files/loader.mp4"/>
        </seq>
    </seq>

    <!-- Main content: starts once caching completes -->
    <par begin="__prefetchEnd.endEvent" repeatCount="indefinite">
        ....
    </par>
</par>
```
