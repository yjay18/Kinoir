# Third-party notices

Kinoir's MIT license covers original project code only. Distributed builds
also contain or interact with separately licensed software and models.

## Included in the core build

| Component | License |
| --- | --- |
| Electron | MIT |
| hls.js | Apache-2.0 |
| qrcode | MIT |
| Transformers.js | Apache-2.0 |
| ffmpeg-static / its FFmpeg executable | GPL-3.0-or-later |
| sentence-transformers/all-MiniLM-L6-v2 model files | Apache-2.0 |

The complete license texts supplied by npm packages remain in their respective
package distributions. Release maintainers should re-audit transitive licenses
whenever dependencies or bundled binaries change.

## Optional, separately installed software

Kinoir can discover and launch Ollama, IINA, and Whisper.cpp. They are not part
of the core Kinoir package and remain governed by their own licenses and
distribution terms.

No optional application's binary should be committed to this repository or
included in a release without a separate license and redistribution review.
