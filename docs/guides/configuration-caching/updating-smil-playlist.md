# Updating SMIL playlist - PULL mode

## Updating the Players

To supply fresh content to a player, one must specify the `Refresh` meta attribute in the first SMIL playlist loaded
from the server. The syntax is as follows:

```xml

<smil>
    <head>
        <!-- How often to refresh the SMIL, values in SECONDS -->
        <meta http-equiv="Refresh" content="60" onlySmilUpdate="true"/>
    </head>
    <!-- Additional elements here -->

</smil>
```

The SMIL player reaches the SMIL playlist URL and checks the `Last-Modified` header. Any change to the `Last-Modified`
value triggers a re-download — this includes both newer versions and rollbacks to older versions. If the server does not
provide a `Last-Modified` header, the player treats the file as unchanged and continues using the cached version.

### Refresh attributes

- `content` - defines the check interval in seconds for both SMIL file and media content. Optional — when the whole
  `Refresh` meta is missing, a default of `20` seconds is used. Values of `0` or below are not supported (there is no
  "disable updates" value; use `onlySmilUpdate` or long intervals instead).
- `contentRefresh` - separate refresh interval in seconds for media content only. When set, media files are checked at
  this interval instead of the `content` value.
- `smilFileRefresh` - separate refresh interval in seconds for the SMIL file itself. When set, the SMIL file is checked
  at this interval instead of the `content` value. Must be a plain number of seconds.
- `onlySmilUpdate` - when set to true, the player only checks the actual SMIL file for updates and not the media
  specified within the SMIL file.
- `fallbackToPreviousPlaylist` - when set to `true`, the player continues playing the previous valid playlist if a newly
  downloaded SMIL file is invalid (fails to download or parse). Prevents a broken upload from taking down playback.
  While in fallback mode, the player re-checks the broken SMIL URL every 60 seconds and switches back once a valid file
  appears. Note: a syntactically valid SMIL file with an *empty* playlist is treated as a valid state (nothing plays) —
  it does not trigger the fallback.
- `timeOut` - timeout in milliseconds for HEAD requests used to check for updates. Defaults to `2000` (2 seconds).
  Increase this value if your server or CDN is slow to respond to HEAD requests.

> ### Important: use a single `<meta>` element
> All Refresh attributes (`content`, `contentRefresh`, `smilFileRefresh`, `timeOut`, `fallbackToPreviousPlaylist`)
> must be placed on **one** `<meta http-equiv="Refresh">` element, as in the examples on this page. `timeOut` and
> `fallbackToPreviousPlaylist` are only read together with `content`/`contentRefresh`, and a second Refresh meta
> element resets them to their defaults.

> ### Split refresh intervals
> If both `content` and `contentRefresh`/`smilFileRefresh` are set, the split values take precedence. For example,
> setting `content="60" contentRefresh="120" smilFileRefresh="30"` will check media every 120 seconds and the SMIL file
> every 30 seconds, ignoring the `content` value for both.

#### Example with split intervals and fallback

```xml
<smil>
    <head>
        <meta http-equiv="Refresh"
              content="60"
              contentRefresh="120"
              smilFileRefresh="30"
              fallbackToPreviousPlaylist="true"/>
    </head>
    <!-- Additional elements here -->
</smil>
```

> ### Important: HEAD requests
>The SMIL player makes a `HEAD` request to check `Last-modified` instead of using GET/POST. This method saves bandwidth.
>
> If you encounter CORS issues, ensure that your CDN/storage supports CORS for `HEAD` requests as well.

If the `Refresh` information is missing, a default value of (`20` seconds) is used.

## See also

- [Check Before Play](check-before-play.md) — check each media file for updates right before playback instead of polling
- [Media Update Configuration](media-update-configuration.md) — per-element update attributes, update mechanisms, and status-code handling

Source: [a-smil.org](https://www.a-smil.org/index.php/Main_Page)
