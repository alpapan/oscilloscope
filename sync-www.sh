#!/bin/sh
# Mirror the browser-served files from the repo root into www/ so Capacitor
# can copy them into the APK. Source-of-truth for editing is the repo root;
# www/ is generated and gitignored.
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="$ROOT/www"
mkdir -p "$DEST"
for f in \
    index.html \
    style.css \
    main.js \
    pixi-shim.js \
    audio-ring-buffer.js \
    audio-worklet-processor.js \
    audio-features.js \
    palette-color.js \
    mesh-warp.js \
    swipe-detector.js \
    mobile-ui.js \
    tv-frame-decode.js \
    favicon.ico \
    icon.svg \
    icon-192.png \
    icon-512.png \
    manifest.webmanifest
do
    cp -f "$ROOT/$f" "$DEST/$f"
done
