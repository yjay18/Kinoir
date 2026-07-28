# Kinoir

Kinoir is a local-first macOS media library and player built with Electron and
plain JavaScript. It organises local video files and Google Drive links, keeps
watch history separate from the shareable library, and can optionally use local
AI tools for recommendations and subtitles.

> Project status: public beta.

## Highlights

- Movies and episodic shows with poster art, metadata, search, and themes.
- Native playback through an installed copy of IINA, with in-app HLS fallback.
- Persistent hover previews that survive removal of the source media file.
- Download and unavailable-file badges based on current filesystem checks.
- Offline semantic search through a bundled MiniLM model.
- Library-grounded AI Concierge through an optional local Ollama installation.
- Optional Whisper subtitle generation.
- Paired, read-only Kinoir Air streaming on the local network.

The core app does not require an account or paid API. Metadata lookup uses
TVMaze and Wikipedia when requested. Optional outside-library search uses a
user-supplied Brave Search key.

## Run from source

Requirements:

- macOS 12 or newer
- Node.js 22 or newer

```sh
npm install
npm start
```

The Electron process starts its own private local server. The old Python and
double-click browser launchers have been removed so there is only one supported
runtime path.

## Optional components

Kinoir detects installed copies and keeps them outside the core package:

- **Ollama** — local AI Concierge. Kinoir starts an installed service when
  needed; model downloads begin only after explicit confirmation in Settings.
- **IINA** — native playback for MKV and other formats.
- **Whisper.cpp** — local subtitle transcription. A compatible model may be
  downloaded on first use.

The app remains usable when any or all of these components are absent. Open
Settings → Optional components to see exact status and setup links.

## Library data

New packaged installs store writable data in `~/Movies/Kinoir`:

```text
Kinoir/
├── Media/
└── library/
    ├── library.json
    ├── watch.json             # optional, personal
    ├── previews.jsonl         # generated mapping
    └── previews/              # generated clips
```

Existing installations continue using `~/Movies/Linkflix` automatically when
that legacy folder is present and no Kinoir folder exists. Kinoir does not move,
rewrite, or delete the old library.

Local paths are never included in Kinoir Air library responses. Removing a
video does not remove its metadata, cover, watch history, or preview. The app
shows the title as unavailable and offers a relink workflow.

Do not commit personal `library.json`, `watch.json`, or generated preview files.

## Kinoir Air

Air is disabled by default. Enable it in Settings to generate a rotating pairing
link and QR code. A paired device can browse, stream, and use the Concierge, but
cannot edit the library, scan folders, generate previews/subtitles, or write data
to the Mac.

Disable Air when it is not in use. Pairing is intended for trusted private Wi-Fi,
not direct exposure to the internet.

## Development

```sh
npm run check
npm test
npm run dist           # unsigned local arm64 .app directory
npm run dist:release   # arm64 + x64 DMG/ZIP release artifacts
```

Release builds automatically use an available Apple signing identity. Public
distribution still requires the maintainer's Developer ID certificate and Apple
notarisation credentials; those credentials must never be committed.

The repository intentionally excludes downloaded models, optional application
packs, generated previews, personal library data, `node_modules`, and `dist`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please use
GitHub's private security-advisory flow for vulnerabilities rather than filing a
public issue. Dependency and optional-tool licensing notes are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Kinoir source code is available under the MIT License. See [LICENSE](LICENSE).
