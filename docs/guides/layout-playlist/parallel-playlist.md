---
sidebar_position: 3
---
# Parallel Playlist

The SMIL parallel playlist is a list of media objects that start playback simultaneously.

Children of the parallel playlist can be specified to start at a specific "wallclock" time defined by the player's real-time clock. See the section on [Wallclock](https://docs.signageos.io/hc/en-us/articles/4405244572178) for details.

## Basic parallel playback

The following example will play both `<seq>` playlists at the same time. Each `<seq>` is playing in its respective region.

```xml
<par>
    <seq repeatCount="indefinite">
        <img src="pic1.jpg" dur="5s" region="main" />
        <img src="pic2.jpg" dur="5s" region="main" />
        <img src="pic3.jpg" dur="5s" region="main" />
    </seq>

    <seq repeatCount="indefinite">
        <img src="side1.jpg" dur="5s" region="side" />
        <img src="side2.jpg" dur="5s" region="side" />
        <img src="side3.jpg" dur="5s" region="side" />
    </seq>
</par>
```

> Parallelism is effectively **per region**: children of a `<par>` targeting *different* regions run concurrently
> (as above), while media elements placed directly in a `<par>` but sharing the *same* region still play one after
> another — a region shows one element at a time. For parallel playback, structure the `<par>` as one child
> `<seq>`/`<par>` per region.

## Slide Show with Background music

> The `<audio>` tag is **not supported** — audio elements in the playlist are ignored at playback time (see
> [Audio](../media/audio.md)). The classic a-smil pattern below is shown for reference only; on the signageOS SMIL
> Player the slide show would play silently. Avoid `<audio>` elements in production playlists — their files are still
> downloaded and consume storage.

```xml
<par>

  <seq repeatCount="indefinite">
    <img src="pic1.jpg" dur="5s" />
    <img src="pic2.jpg" dur="5s" />
    <img src="pic3.jpg" dur="5s" />
  </seq>

  <audio src="music.mp3" repeatCount="indefinite" />

</par>
```

Source: [a-smil.org](https://www.a-smil.org/index.php/Main_Page)
