---
sidebar_position: 2
---

# Sequence Playlist

The sequential playlist is the simplest form of playlists in SMIL.

In a sequential playlist, media objects are played in the order they are listed in the SMIL playlist. One media object
starts playing after the preceding one ends.

## Simple loop

```xml

<seq repeatCount="indefinite">

    <video src="ad1.mpg" region="main"/>
    <video src="ad2.mpg" region="main"/>
    <img src="ad3.png" dur="5s" region="main"/>

</seq>
```

Loop 2 videos and 1 JPEG indefinitely.

## Nested loop

```xml

<seq repeatCount="indefinite">

    <video src="ad1.mpg" region="main"/>

    <seq repeatCount="2">
        <video src="ad2.mpg" region="main"/>
        <img src="ad3.png" dur="5s" region="main"/>
    </seq>

</seq>
```

Plays the sequence: ad1, ad2, ad3, ad2, ad3 and repeats the entire sequence endlessly.

> When mixing nested `<seq>`/`<par>` groups with plain media inside one `<seq>`, keep the nested groups **next to each
> other** (contiguous). Structure tags of the same name that are separated by media elements are merged during XML
> parsing, which changes the playback order.

## Default repeat count

When a `<seq>` or `<par>` has no `repeatCount`, it plays once. You can change this default globally with the
`defaultRepeatCount` meta attribute in the SMIL `<head>` — it applies to every `<seq>`/`<par>` that does not specify
its own `repeatCount`:

```xml
<meta defaultRepeatCount="indefinite"/>
```

Accepted values are `1` and `indefinite`.

Source: [a-smil.org](https://www.a-smil.org/index.php/Main_Page)
