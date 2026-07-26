# Linkflix 🎬

Linkflix is a personal, native macOS media organizer and player built with Electron, HTML/CSS, and Vanilla JavaScript. It runs 100% locally on your Mac, featuring zero-dependency local network sharing, local AI assistance, offline subtitle generation, and local semantic search.

No accounts, no external databases, no paid APIs.

---

## Getting Started

### Prerequisites

To get the full set of local AI features, make sure you have the following installed on your Mac:

1. **Node.js & npm**: Installed from [nodejs.org](https://nodejs.org/).
2. **FFmpeg**: Bundled automatically by the app via `ffmpeg-static`, but needed on PATH if you are transcribing subtitles or running software encoding.
3. **Ollama**: (Optional, for tag enrichment & AI chatbot). Download and run it locally from [ollama.com](https://ollama.com/).
4. **Whisper**: (Optional, for offline subtitle generation). Install via Homebrew:
   ```sh
   brew install whisper-cpp
   ```

### Running the App

Double-click **`Linkflix.command`** in the root of the folder. 
This starts the local backend server, launches the native Electron application, and opens the player.

*First time only: macOS may block execution. Right-click `Linkflix.command` → Select **Open** → Click **Open**, or run `chmod +x Linkflix.command` in your Terminal.*

Alternatively, run in the Terminal:
```sh
npm install
npm start
```

---

## Features

### 📡 Linkflix Air (Local Network Streaming)
Open **Settings** inside the app to see a generated QR code and your Mac's local network address. Scan the QR code with your iPhone, iPad, or Smart TV connected to the same Wi-Fi to browse your entire library and stream HLS transcodes directly to your device (complete with native PiP/AirPlay support).

### 🔍 Local Semantic Search
Find what you want to watch by searching for concepts or moods (e.g., *"gritty cyberpunk crime"* or *"lighthearted space adventure"*). Powered entirely offline by `Transformers.js` using a pre-bundled 22MB ONNX model (`all-MiniLM-L6-v2`) with embedding vectors cached locally in **IndexedDB**.

### 💬 Local AI Subtitle Generator (Whisper)
Have a video file without subtitles? Click the `⋯` More Actions button in any movie or show detail page, select **Generate subtitles**, and Linkflix will use your local GPU/CPU to transcribe the audio into a `.vtt` sidecar file next to the video. No audio or transcripts ever leave your Mac.

### 🎥 Native Local Playback & HLS Web Player
- **Native Player (macOS)**: Opens every local file (including `.mp4`, `.mkv`, and `.avi`) in the bundled **IINA.app**, bypassing QuickTime and macOS file-association defaults.
- **HLS Web Player**: For local network streaming (Safari, mobile devices, etc.), the backend dynamically transcodes/remuxes files on-the-fly to Apple-friendly HLS.

### 📁 Media Folder Auto-Scanning
Point Linkflix to your media folders. The scanner automatically detects movie and TV series structures, parses messy folder/file names, checks them against TVMaze & Wikipedia metadata, and automatically filters out torrent metadata, `.torrent` files, and junk video files (bloopers, trailers, featurettes, and samples).

### 🏷 Ollama Tagging & AI Concierge
Chat with your personal local library helper. Ollama enriches your titles with 5 deterministic, descriptive tags, allowing you to ask the concierge for highly grounded recommendations, custom local-library playlists, or smart collections.

### 🎭 Hover Teaser Previews
Hover over any card in your library to see a looping preview clip containing four short moments, with source audio when available, stitched dynamically from the local video file. Cached mappings load immediately, while missing previews are warmed in a small startup batch and then generated on demand, one at a time. Preview clips live in `library/previews/` and their shareable `library/previews.jsonl` manifest maps each title id to its clip. This is separate from personal `watch.json`. Use a title's `⋯` menu and **Generate preview from file…** to choose a show's first episode in Finder.

---

## Technical Architecture

- **Backend**: Built in Node.js (Electron Main Process & custom HTTP API server) to handle dialogs, HLS transcoding, metadata lookup, and subprocess execution (ffmpeg/whisper).
- **Frontend**: Plain HTML, Vanilla CSS, and modern ES6 JavaScript modules. No frameworks, build steps, or webpack bundlers.
- **Storage**: Browser `localStorage` is used for responsive UI state, backed up automatically to disk at `library/library.json` and `library/watch.json`; shareable preview clips and their mappings live separately in `library/previews/` and `library/previews.jsonl`.
