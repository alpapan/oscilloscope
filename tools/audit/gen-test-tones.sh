#!/usr/bin/env bash
# Generate the composite test tone used by AudioCaptureTest to verify the spectrum view renders captured
# audio. It sums one pure sine per audio-features.js band - 100 Hz (bass 20-250), 1500 Hz (mid 250-4000),
# 9000 Hz (treb 4000-20000) - so a single spectrum screenshot under it shows three peaks at left/centre/right,
# confirming the capture -> FFT -> spectrum render maps frequency to position. test-tone.ogg (A4, 440 Hz) is
# the separate general capture-liveness tone and is left untouched.
# Regenerate with:  bash tools/audit/gen-test-tones.sh   (requires ffmpeg)
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../.." && pwd)/android/app/src/androidTest/assets"
# A single 16-bit PCM WAV at 44100 Hz summing one tone per band - 100 Hz (bass), 1500 Hz (mid), 9000 Hz (treb).
# One file because the harness captures audio cleanly only in the FIRST capture session per instrumentation
# process; a single composite captured once lets a single spectrum screenshot show all three band peaks
# (left / centre / right). PCM (not OGG) because the on-device capture did not pick up ffmpeg's libvorbis output.
echo "generating the composite band tone in $OUT"
ffmpeg -y -v error \
  -f lavfi -i "sine=frequency=100:duration=2:sample_rate=44100" \
  -f lavfi -i "sine=frequency=1500:duration=2:sample_rate=44100" \
  -f lavfi -i "sine=frequency=9000:duration=2:sample_rate=44100" \
  -filter_complex "amix=inputs=3:normalize=0,volume=2" -ac 1 -c:a pcm_s16le "$OUT/tone-bands-100-1500-9000hz.wav"
echo "  tone-bands-100-1500-9000hz.wav (100+1500+9000 Hz). test-tone.ogg (A4 440 Hz liveness tone) is untouched."
