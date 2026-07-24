---
sidebar_position: 5
---
# SMIL Player Configuration
You can configure certain parameters of the SMIL Player using Timing Configuration. Here is the list of built-in options:

- `smilUrl` is used for passing URL of the smil file, no default
- `backupImageUrl` is used for defining a failover image that will be shown in case the smil file is corrupted or fatal error occurs during playback, default built-in image
- `serialPortDevice` is used for defining custom device address used for serial communication (like Nexmosphere sensors), default is `/dev/ttyUSB0`
- `videoBackground` this value accepts true and false values; when `true`, videos play on the background video plane, allowing HTML content to be layered above them
- `reportUrl` custom reporting endpoint URL. When set, the player POSTs proof-of-play reports to this endpoint. It overrides the `endpoint` from the SMIL `<meta>` logging configuration, force-enables reporting, and *adds* the proof-of-play type to whatever logging types the SMIL file configures (it does not replace them). See [Custom Endpoint Reporting](../reporting/custom-endpoint.md)
- `syncGroupName` identifies which devices should be synchronised together. **Required** for any synchronization — without it the player skips sync setup entirely (there is no default group). Config-only; it cannot be set via the SMIL `<meta>` tag
- `syncServerUrl` URL of the synchronisation server. When set, devices coordinate through that server (works across networks). When omitted, the player falls back to **local-network peer-to-peer** (UDP/TCP) — devices must be on the same LAN; no cloud server is contacted. Config-only; the SMIL `<meta>` tag is not consulted
- `syncGroupIds` comma-separated list of the device identifiers in the sync group. Required for the sync failover triggers. Note: when set, sync coordination automatically suspends (devices free-run) whenever any listed device is offline, and resumes when all are back
- `syncDeviceId` this device's identifier within `syncGroupIds`. Required for failover triggers; when omitted, a random identifier is generated on each boot
- `debugEnabled` set to `true` to enable debug logging output (disabled by default)

![SMIL Applet configuration via timing config](config.png)
