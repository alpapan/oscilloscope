# Privacy policy - Scope

**Effective date:** 2026-05-31

## Developer

Scope is published by **Alexie Papanicolaou**. For questions about this privacy policy or the app's data handling, contact **greenbluekats@gmail.com**.

## Summary

Scope is a music oscilloscope. It captures audio from your device and renders it as a real-time visualisation on screen. **No audio, no settings, no identifiers, and no other personal data are transmitted off your device.** Everything happens inside the app on the device you installed it on.

## Data we collect and access

- **Audio** - captured live via either (a) the Android `MediaProjection` API (the operating system's system-audio loopback path), or (b) the device microphone. The audio stream is fed directly into the visualisation pipeline and is **not** recorded to disk, **not** transmitted off the device, and **not** analysed for any purpose other than producing the on-screen waveform / spectrum / Lissajous rendering.
- **App settings** - your theme, sensitivity, smoothing, FFT detail, and microphone preference are stored in the WebView's local storage on the device. They may be included in Android's standard auto-backup if you have Google Drive backup enabled on your device, so your preferences carry between reinstalls. The app itself never transmits these settings anywhere.
- **Now playing (optional)** - if you grant notification access, Scope reads the media-session metadata (track title, artist, album, and album art) that the app currently playing audio advertises through Android's media notification, so it can show what is playing. Scope reads **media-session metadata only** - never the content of any other notification. This information is shown on screen and, when you have paired a Scope TV on your local network, sent to that TV over the local connection only. It is **not** recorded to disk and **never** transmitted off your local network.

## Microphone

The microphone is used **only** as a fallback for audio sources that the Android `MediaProjection` system cannot capture (for example, apps such as Spotify that mark their audio output with `FLAG_NO_MEDIA_PROJECTION`). When microphone capture is active, the audio stream from the microphone is fed into the same on-device visualisation pipeline as system audio. **The microphone stream is not recorded, not transmitted, and not retained.**

Microphone access requires an explicit grant of Android's standard `RECORD_AUDIO` runtime permission. You can revoke this permission at any time in your device's app settings; the app will fall back to system-audio capture when it loses the permission.

## Permissions and why we ask for them

- **RECORD_AUDIO** - for the microphone fallback path described above.
- **FOREGROUND_SERVICE / FOREGROUND_SERVICE_MEDIA_PROJECTION / FOREGROUND_SERVICE_MICROPHONE** - required by Android 14+ to run the capture service while the app is in the background (e.g. picture-in-picture mode).
- **POST_NOTIFICATIONS** - required by Android 13+ so the foreground service can show its mandatory ongoing notification.
- **Notification access (NotificationListenerService)** - optional, off until you turn it on in system settings. Used **only** to read media-session metadata (now-playing track title, artist, album, and album art) from the app playing audio. Scope never reads the content of any other notification.
- **INTERNET** + **CHANGE_WIFI_MULTICAST_STATE** - used **only** for the optional local-network feature that pairs the Scope phone app with a Scope Android TV app on the same Wi-Fi (using Network Service Discovery and a direct local TCP socket). The app does **not** make outbound internet connections during normal use; all network traffic is restricted to your local network.

## Third parties

Scope does **not** include any third-party advertising, analytics, crash reporting, or tracking SDKs. No data is shared with any third party.

## Children

Scope is not directed at children. The app handles no personal data and is content-rated **Everyone**; nevertheless we do not market the app to children or knowingly collect data from children under 13.

## Changes to this policy

This policy is versioned by Git commit on the project's public source repository. Each substantive revision produces a new commit on the `main` branch; the URL referenced from the Play Store listing is pinned to the specific commit revision in force at the time of the listing update. Historical revisions remain readable in the repository's Git history.

## Your choices

- You can decline the per-session `MediaProjection` consent dialog and the `RECORD_AUDIO` permission at any time - the app remains usable but cannot capture audio.
- You can uninstall the app at any time. Uninstalling deletes all locally-stored settings.
- If Android auto-backup has stored your settings on Google's servers, you can delete that data through the Google Drive web interface (Settings -> Manage backups).

## Contact us

For any question, concern, or data-deletion request related to this policy or the app's data handling, contact the developer at **greenbluekats@gmail.com**. Because the app does not collect or transmit personal data, there is nothing to request the deletion of from any server we control; this email is for clarification questions only.
