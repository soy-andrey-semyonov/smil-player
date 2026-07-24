# Image

signageOS SMIL Player supports multimedia objects, including videos, images, streams, video inputs, HTML5 widgets and
HTML5 websites.

## Basic usage of still Image

A simple image played for defined duration.

```xml

<img src="ad2.jpg" dur="5s" fit="fill"/>
```

### Using Query Parameters

Images can include query parameters for dynamic content, versioning, or tracking purposes. Each unique URL with
different query parameters will be cached as a separate file.

```xml
<!-- Different banner versions cached separately -->
<img src="https://example.com/banner.jpg?version=1.0&amp;lang=en" dur="5s" region="main"/>
<img src="https://example.com/banner.jpg?version=1.0&amp;lang=es" dur="5s" region="main"/>

        <!-- Dynamic image selection based on parameters -->
<img src="https://cdn.example.com/promo.jpg?campaign=holiday&amp;week=1" dur="10s" fit="cover"/>
```

**Note:** Remember to use `&amp;` instead of `&` for proper XML encoding when separating query parameters.

The `dur` attribute specifies a duration of the still image during playback. The valid value is either with or without
`s`econds - `dur="10"` `dur="10s"`. Decimals are allowed (e.g. `dur="10.45s"`), and `dur="indefinite"` keeps the image
on screen. When `dur` is omitted, a default of **5 seconds** is used. SMIL clock-values like `dur="3000ms"` or
`dur="01:02:03"` are **not** supported and will be misread as seconds.

The `fit` attribute defines how to position image within the region. Options are:

| Fill option | Description                                                                                                                                                                     |
|:------------|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `fill`      | Default option <br />Shrink or stretch the content to completely fill the area (without preserving aspect ratio)                                                                |
| `meet`      | Scale the content while preserving aspect ratio until one of the dimensions meets the that of the area <br />Similar to css property `object-fit: contain`                      |
| `meetBest`  | Not implemented, behaves the same as `meet`                                                                                                                                     |
| `cover`     | Image is sized to maintain its aspect ratio while filling the element's entire content box. The object will be clipped to fit <br />Similar to css property `object-fit: cover` |

Unknown `fit` values fall back to `fill`. The `fit` attribute may also be set on the `<region>` element as a default
for all its media. Additionally, when you need to overlap images, you can assign `z-index` directly to the `<img>`
element (e.g. `z-index="5"`) — note this works for images, widgets, and tickers, but not for videos.

## Images transitions

Smil player offers an option to create a crossFade or billboard transition between two images or image and widget. If
there is a video after image in the playlist, the transition will not be displayed. Transition image -> widget works
only for crossFade transition. Billboard transition supports only image -> image use case.

[Crossfade transition](../transitions/crossfade-transition.md)\
[Billboard transition](../transitions/billboard-transition.md)
