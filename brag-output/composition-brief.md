# Hyperframes Composition Brief: Kinoir

## Objective
Create a 20-second launch-style brag video for Kinoir that makes a personal movie collection feel cinematic while proving the product remains local-first.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `/Users/yuuvjauhari/linkflix`
- Primary files read: `index.html`, `css/styles.css`, `js/views.js`, `js/concierge.js`, `README.md`, `docs/index.html`, `docs/styles.css`
- Product name: Kinoir
- Tagline / strongest claim: “Your films. Your files.” and “No service in the middle.”
- Key UI or visual moment to recreate: real graphite library UI moving from home to semantic search to the local library-only Concierge
- Copy that must appear verbatim:
  - `Your films.`
  - `Your files.`
  - `A front end for the collection you already have.`
  - `Search the way you remember.`
  - `Ask your own library.`
  - `Runs locally via Ollama · library-only`
  - `No service in the middle.`

## Creative Direction
- Tone preset: polished
- Creative direction: quiet cinematic macOS product film in graphite smoked glass
- Interpretation: use confident scale, generous holds, deep but restrained parallax, and three deliberate audio accents. Avoid frantic editing or loud tech spectacle.
- Angle: The viewer already owns the collection. Kinoir gives it a cinematic, searchable, private home without placing a new service between the viewer and their media.
- Hook: the tactile K icon alongside “Your films. Your files.” in the first 3.27 seconds
- Outro / punchline: “No service in the middle.”
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Waveforms, equalizer bars, generic particles, neon-cyan-on-black defaults, or full-screen linear gradients
  - Invented claims such as universal format support or fully offline cloud playback

## Visual Identity
- Background: `#090b0f`
- Text: `rgba(242, 245, 250, 0.94)`
- Accent: `#a7b0c0`
- Secondary accent: `#75849d`
- Display font: SF Pro Display / `-apple-system`, BlinkMacSystemFont, `Segoe UI`, sans-serif
- Body font: same system family, lighter weight
- Visual references from the project: graphite theme variables, smoked-glass panels, cool-silver focus rings, ambient charcoal orbs, real home/library/Concierge screenshots, embossed K icon

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The collection is yours — 3.27s — graphite K plus “Your films. Your files.”
2. The collection, in motion — 5.47s — real home/library UI and hover preview
3. Search the way you remember — 4.37s — simulated semantic query over the real library
4. Ask your own library — 4.36s — real local Concierge and playable recommendation
5. No service in the middle — 2.53s — final K / privacy lockup

## Audio
- Audio role: sparse cinematic support
- Audio arc: restrained bed from frame 0, one tactile lift for each product action, then a fade beneath the closing hold
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: baseline volume around 0.22–0.28; never above 0.5; fade gently across the final 1.4 seconds
- Music cue guidance: bundled preset copied to `assets/music/cues/`; 109.96 BPM; beat-lock major reveals at 8.74s, 13.11s, and 17.47s (`±0.15s`); use the 9.29–10.93s grid for grouped query typing without outrunning readability
- Audio-reactive treatment: subtle; pre-extract per-frame audio data and map bass/RMS to a 2–5% breathing change in existing background glows or window presence. Do not pulse text.
- Audio-coupled moments:
  - 8.74s — search field focus and one quiet click
  - 13.11s — Concierge panel landing and one soft interface accent
  - 17.47s — final icon/headline landing and one warm impact
- SFX selection guidance: prefer the low-risk `interface/click_003.ogg`, `interface/bong_001.ogg`, and `impact/impactSoft_medium_001.ogg`; keep them sparse and below the music’s perceived focal level
- SFX analysis guidance: `/Users/yuuvjauhari/.agents/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: the implemented composition uses the three low-risk files above at the corresponding motion starts
- Audio files: copy music and selected SFX into `brag-output/composition/assets/`

## Hyperframes Instructions
Use `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`, and `hyperframes-cli`. This is the `/brag` workflow; do not route into the generic Hyperframes intent interview or product-launch workflow.

Requirements:
- Show real Kinoir UI in three middle scenes.
- Keep all copy readable at 1920x1080 and within the source graphite palette.
- Use one standalone composition and one paused GSAP timeline; prefer wrapper transforms and native CSS over extra runtime dependencies.
- Give screenshot media deliberate wrapper motion: perspective entrance, small crop pan, and restrained scale; do not apply improvised media filters.
- Total duration is exactly 20 seconds.
- Include the music bed and three motion-matched SFX.
- Treat cue data as guidance; readability and product clarity remain primary.
- Mark the search reveal, Concierge landing, and final lockup in source comments as beat-grid / beat-locked moments.
- Use pre-extracted audio data for subtle background/window breathing if extraction succeeds; document and skip it if unavailable.
- Run `hyperframes check --snapshots` before preview and render.
