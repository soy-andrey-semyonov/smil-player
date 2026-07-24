# Ticker

The `<ticker>` element allows the display of scrolling text (ticker) on the screen. It is configurable in terms of
appearance, speed, and content.

## Basic Usage

Simple ticker running from right to left with a text content.

```

<ticker region="image" dur="10s" fontName="Arial" fontSize="30"
        fontColor="#ffd800" linearGradient="#ff0000 0%, #aa9999 100%"
        indentation="50" velocity="50">
    <text>This is testing content for new Ticker component.</text>
    <text>This is another testing content for new Ticker component.</text>
</ticker>
```

- **region:** logical part of the screen where the ticker will be displayed.
- **dur:** specifies a duration of the ticker during playback. The valid value is either with or without
  `seconds` - `dur="10"` `dur="10s"`. Decimals are allowed; when omitted, a default of 5 seconds is used.
- **fontName:** name of the font used for the text. The font is loaded from **Google Fonts** at runtime, so the device
  needs network access for a custom font (otherwise the browser fallback font is used). A `-Bold` suffix (e.g.
  `Roboto-Bold`) selects the family and renders it bold.
- **fontSize:** size of the text in pixels. Defaults to 60% of the region height.
- **fontColor:** color of the text.
- **linearGradient:** gradient of the ticker background, e.g. `linearGradient="#ff0000 0%, #aa9999 100%"`.
- **linearGradientAngle:** angle of the gradient in degrees (default `0`).
- **backgroundColor:** solid background color of the ticker strip; ignored when `linearGradient` is set.
- **indentation:** initial space between the text and the edge of the screen, in pixels (default `100`).
- **velocity:** speed of the text scrolling in pixels per second (default `100`).
- **z-index:** stacking order when the ticker overlaps other content.

Tickers also support the per-element update and proof-of-play attributes shared by all media types (see
[Media Update Configuration](../configuration-caching/media-update-configuration.md) and
[Proof of Play](../reporting/proof-of-play.md)).

### Text Element

Represents individual messages in the ticker.
The `<ticker>` element can contain multiple `<text>` elements, which will scroll sequentially.
Each `<text>` element contains a string that will be displayed as part of the ticker.

```xml

<text>This is testing content for new Ticker component.</text>
<text>This is another testing content for new Ticker component.</text>
```

The ticker will play the first message, then the second message, the first message and so on.

## Example

```xml

<ticker
        region="image"
        dur="10s"
        fontName="Arial"
        fontSize="30"
        fontColor="#ffd800"
        linearGradient="#ff0000 0%, #aa9999 100%"
        indentation="50"
        velocity="50">
    <text>Text1.</text>
    <text>Text2.</text>
</ticker>
```

- Displays a ticker in the image region for 10 seconds.
- Uses the Arial font at a size of 30px in yellow (#ffd800).
- Adds a red-to-gray gradient effect.
- Scrolls text starting 50 pixels from the edge at a speed of 50 pixels/second.
- Displays "Text1." and "Text2." sequentially.
