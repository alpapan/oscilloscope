# Scope - Security Overview

Audience: Google Play reviewers and security auditors. This document describes
what the app does with data, why each permission is requested, and how the only
network feature (phone-to-TV mirroring over the local network) is secured.

## Summary

Scope is an offline music oscilloscope. It captures audio that is already
playing on the device, turns it into a visualisation, and draws it on screen.
It has no user accounts, collects no personal data, contacts no servers, and
sends no analytics. The only network traffic is an optional, local-Wi-Fi-only
channel that lets a phone drive a visualisation on a paired Android TV on the
same network. Raw audio never leaves the device on that channel.

## Data handling

- No personal data is collected, stored, or transmitted.
- No cloud services, no third-party SDKs that phone home, no advertising IDs.
- Captured audio (PCM) exists only in memory on the device while a visualisation
  is running. It is never written to disk and never sent over the network.
- App settings live in the WebView's local storage on the device. There is
  nothing sensitive to back up, which is why backups are disabled (see below).

## Permissions and why each is needed

- `RECORD_AUDIO`: required to read the audio stream for visualisation. In the
  default mode this is system playback captured through `MediaProjection` plus
  `AudioPlaybackCapture`; an optional mode uses the microphone. Audio is used
  only to compute the on-screen waveform and spectrum.
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`,
  `FOREGROUND_SERVICE_MICROPHONE`: capture runs in a foreground service with a
  visible, persistent notification so the user is always aware capture is
  active, as required for media-projection and microphone capture.
- `INTERNET`: used only to open a TCP socket on the local network for the
  optional phone-to-TV mirroring feature. The app makes no internet requests.
- `CHANGE_WIFI_MULTICAST_STATE`: needed to hold a multicast lock so mDNS service
  discovery (`_scope._tcp.`) works on Wi-Fi, which is how a phone finds a TV on
  the same network. Without it Wi-Fi power saving filters the discovery packets.
- `POST_NOTIFICATIONS`: to show the capture notification on Android 13 and above.

## Phone-to-TV channel

The mirroring feature connects a phone (sender) to an Android TV (receiver) over
raw TCP on port 8765, discovered with mDNS service type `_scope._tcp.`. Both
ends are native Kotlin. The phone computes the visualisation geometry and sends
compact analysis frames (downsampled waveform points and spectrum magnitudes);
the TV is a thin renderer. No audio samples are sent.

### Authenticated encryption

Every byte on this channel after pairing is encrypted and authenticated. The
protocol is mutually authenticated against a six-digit code shown on the TV and
typed on the phone. The code is never sent over the network; it is mixed into
the key derivation, so only a phone and TV that both hold the same code can
derive the same key.

- Key agreement: X25519 Elliptic Curve Diffie-Hellman. Both ends generate a
  fresh ephemeral key pair for every connection, so each pairing has a unique
  key and a delayed frame from an old session cannot be decrypted.
- Key derivation: HKDF-SHA256. The salt is `SHA-256(phonePublicKey ||
  tvPublicKey)` in a fixed order, and the expansion info is bound to a protocol
  label and the six-digit code.
- Record encryption: AES-256-GCM with a 128-bit authentication tag. Each record
  carries a 12-byte nonce whose first byte encodes the direction and whose last
  eight bytes are a per-direction counter that increases by one per record.
  Because the key is unique per session, the direction byte differs between the
  two ends, and the counter is monotonic, no nonce is ever reused.
- Replay and tamper protection: the receiver rejects any record whose counter is
  not greater than the last accepted one, and GCM rejects any altered record.

These primitives are provided by the platform crypto provider (Conscrypt on
Android API 34 and above), which supports X25519, HKDF via HMAC-SHA256, and
AES-256-GCM natively. No third-party crypto library is bundled.

### Denial-of-service hardening

The TV listener is built to stay available even if a hostile device on the same
Wi-Fi sends malformed or abusive traffic:

- Pre-pairing frames are capped at 4096 bytes and the whole handshake has a
  5-second deadline, so an unauthenticated peer cannot make the TV buffer large
  inputs or hold a connection open indefinitely.
- A per-source-IP connection rate limiter (default 10 connections per 10
  seconds) backed by a size-bounded LRU map prevents connection floods and
  unbounded memory growth.
- A failed-pairing lockout (default 5 failures, then a 30-second lockout) plus
  code rotation on every failed attempt makes online guessing of the six-digit
  code impractical.
- The accept loop survives transient socket errors instead of dying on the first
  one, and every network-supplied numeric field (view id, waveform point count,
  FFT bin count, channel count, FFT size) is clamped to a safe range before use.

## App configuration hardening

- `android:allowBackup="false"`: the app holds nothing worth backing up, and
  disabling backup avoids copying app state off the device.
- The unused `FileProvider` declaration and its file-path rules were removed, as
  were the empty backup-rules resources, to reduce attack surface.
- The optional desktop (Electron) build denies all new-window requests and blocks
  navigation away from the bundled app origin.

## Known and accepted points

- The `res/xml/config.xml` file generated by the Capacitor build tool contains a
  Cordova-era `<access origin="*"/>` element. This file is regenerated on every
  build and is inert for this app: Capacitor controls WebView navigation through
  `capacitor.config.json`, where `server.allowNavigation` is unset, so the
  WebView is locked to the bundled app origin. The entry grants no real access.
- The pairing channel is local-network only and is never exposed to the
  internet. The threat model is a malicious device on the same Wi-Fi; remote
  attackers have no path to the socket.
- The six-digit code provides roughly one million possibilities. Combined with
  on-screen human verification, per-failure code rotation, and the failed-attempt
  lockout, this is sufficient for a short-lived local pairing handshake.

Prepared by Claude (Anthropic) as part of the app's security hardening work.
