# Triggers using Keyboard

From v1.4.0, you can use keyboard key presses as a trigger for activating content playback in the SMIL Playlist.

## Using keyboard to trigger content

### Define a trigger based on a key press sequence

- The `origin` is always set as `keyboard`.
- `data` defines the key sequence pressed on the keyboard (in the example below the trigger will become active if you
  press 5 times `a`)
- The action is set to `keydown` (the player listens for key-down events; the attribute value itself is informational).

You can define any number of triggers with various `data`. Each `data` has to be unique, and one `data` should not be
a substring of another.

Keys must be pressed in quick succession — the sequence buffer resets if more than **200 ms** pass between two
keystrokes. Modifier and function keys (Shift, Ctrl, Enter, F1–F12, …) are ignored and neither extend nor reset the
sequence.

```xml

<trigger id="trigger1" condition="or">
    <!-- origin: trigger source; data: key string to match; action: keyboard event -->
    <condition origin="keyboard" data="aaaaa" action="keydown"/>
</trigger>
```

### Define region for triggered content

Read more about regions for triggered content in the
the [Triggers article](https://docs.signageos.io/hc/en-us/articles/4405241368978).

```xml

<layout>
    <!-- define the screen resolution -->
    <root-layout width="1920" height="1080" backgroundColor="#18182c"/>

    <region regionName="trigger-region" left="10" top="10" width="1280" height="720">
        <!-- Single sub-region filling the parent region completely -->
        <region regionName="trigger-sub-region1"
                left="0"
                top="0"
                width="100%"
                height="100%"
        />
    </region>
</layout>
```

### Define content triggered by the keyboard trigger

```xml

<par>
    <!-- referencing <trigger id="trigger1"> defined in <head>      -->
    <seq begin="trigger1">
        <video src="https://demo.signageos.io/smil/zones/files/video_1.mp4"
               region="trigger-region"> <!-- As a region you always set the parent of the sub-regions -->
        </video>
    </seq>
</par>
```

### Trigger duration

It's possible to specify trigger duration either by the **dur** attribute, which takes values in seconds, or by the
**repeatCount** attribute, which counts each play of the trigger. With `dur`, the trigger content loops until the
duration expires; when both are set, `dur` wins. Re-typing the key sequence while the trigger is already playing
**extends** its duration (the countdown restarts from the latest key press).

```xml

<par>
    <!-- referencing <trigger id="trigger1"> defined in <head>  
    -->
    <seq begin="trigger1" repeatCount="4">
        <video src="https://demo.signageos.io/smil/zones/files/video_1.mp4"
               region="trigger-region"> <!-- As a region you always set the parent of the sub-regions -->
        </video>
    </seq>
    <seq begin="trigger2" dur="10">
        <video src="https://demo.signageos.io/smil/zones/files/video_2.mp4"
               region="trigger-region"> <!-- As a region you always set the parent of the sub-regions -->
        </video>
    </seq>
</par>
```

### Trigger cancellation

By default, a trigger is canceled by itself when it's finished playing, or by another trigger that was triggered later
**into the same sub-region** (with several free sub-regions, both triggers play side by side instead). If
you want to cancel a trigger prematurely, without running any other trigger, you can specify the **end** attribute with
the same
value specified in **begin** attribute. This way when you press sequence to activate trigger which is already playing,
it will be canceled, and the SMIL player will resume the original playback.

The **end** attribute can also name a *different* trigger — see
[cross-trigger cancellation](triggers-interactivity.md#cross-trigger-cancellation).

```xml

<par>
    <!-- referencing <trigger id="trigger1"> defined in <head>  
    -->
    <seq begin="trigger1" end="trigger1" repeatCount="4">
        <video src="https://demo.signageos.io/smil/zones/files/video_1.mp4"
               region="trigger-region"> <!-- As a region you always set the parent of the sub-regions -->
        </video>
    </seq>
</par>
```
