# 🎬 YouTube Subtitle Sidebar

> A modern, glassmorphic Chrome Extension (Manifest V3) that extracts, syncs, and displays YouTube subtitles in an interactive sidebar with real-time video playback synchronization, instant search, click-to-seek, and full transcript copying.

---

## ✨ Features

- ⚡ **Real-Time Video Sync**: Automatically highlights active subtitle lines and smoothly scrolls the transcript in real-time as the video plays.
- 🎯 **Click-to-Seek**: Click on any transcript line to jump the video directly to that exact timestamp.
- 🔍 **Instant Keyword Search**: Filter lines live with real-time mark highlighting.
- 🛡️ **Failproof 4-Layer Subtitle Extraction**:
  1. **Live Network Interception**: Captures timedtext XHR/Fetch payloads in real-time.
  2. **YouTube Player API**: Intercepts `movie_player.getPlayerResponse()` and `window.ytInitialPlayerResponse`.
  3. **YouTube Innertube API**: Fallback direct queries to YouTube's player endpoints.
  4. **DOM Scraper**: Extracts lines directly from YouTube's native transcript elements if network requests are blocked.
- 🌐 **Multi-Format Parser**: Built-in support for **JSON3**, **Standard XML** (`<text>`), **SRV3 XML** (`<p t="..." d="...">`), and **WebVTT** formats.
- 📋 **One-Click Copy**: Copy the entire formatted transcript with timestamps to your clipboard.
- 🎨 **Glassmorphism UI**: Native YouTube dark mode styling integrated directly into YouTube's secondary sidebar layout.

---

## 🛠️ How It Works & Architecture

The extension uses Chrome Extension Manifest V3 with a two-world architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                      YouTube Page                           │
│                                                             │
│  ┌───────────────────────┐       window.postMessage        │
│  │   src/injected/       │ ──────────────────────────────┐ │
│  │   (MAIN World)        │                               │ │
│  │ Intercepts XHR/Fetch  │                               ▼ │
│  │ & Player Responses    │                     ┌──────────────────┐
│  └───────────────────────┘                     │  src/content/    │
│                                                │ (ISOLATED World) │
│  ┌───────────────────────┐                     │ Receives data,   │
│  │   YouTube Player      │                     │ parses formats,  │
│  │  & DOM Transcript     │                     │ renders sidebar  │
│  └───────────────────────┘                     └──────────────────┘
└─────────────────────────────────────────────────────────────┘
```

### Modular Code Base (`src/`)

```text
src/
├── utils/
│   ├── time.js                # Timestamp formatting (MM:SS / HH:MM:SS)
│   └── sanitize.js            # Safe HTML escaping & URL query parameter cleanup
├── content/
│   ├── parsers/
│   │   ├── jsonParser.js      # JSON3 event & segment parser
│   │   ├── xmlParser.js       # XML (<text>) and SRV3 (<p t="" d="">) parser
│   │   ├── vttParser.js       # WebVTT cue parser
│   │   └── index.js           # Central multi-format parser dispatcher
│   ├── dom/
│   │   ├── domScraper.js      # DOM element scraper fallback for ytd-transcript
│   │   ├── nativeTrigger.js   # Automated trigger for native YouTube transcript button
│   │   └── sidebarUI.js       # Dynamic UI container & component renderer
│   ├── state.js               # Centralized extension state management
│   └── sync.js                # Video timeupdate listener & smooth auto-scroll sync
└── injected/
    ├── interceptors.js        # XHR/Fetch response text & window property interceptors
    ├── trackExtractor.js      # Extraction logic for movie_player & initial response
    └── innertube.js           # YouTube Innertube API fallback handler
```

---

## 🚀 Installation & Setup

### 1. Load in Chrome (Developer Mode)

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked**.
5. Select the project directory (`custom-subtitles`).
6. Navigate to any YouTube video (e.g., `https://www.youtube.com/watch?v=xTaPfmuG5vk`).

### 2. Building from Source

If you make modifications to any file inside `src/`:

```bash
# Build injected.js and content.js bundles
node build.js
```

---

## 🎨 Controls & Interface

- **Auto-Scroll Toggle**: Enable or disable automatic scrolling to current subtitle line.
- **Copy All**: Copies the full transcript formatted as `[MM:SS] Subtitle line text`.
- **Collapse/Expand**: Hide or show the subtitle sidebar.
- **Track Selection**: Switch between available caption tracks or auto-generated languages.
- **Search Bar**: Live search with yellow keyword highlighting.

---

## 📄 License

MIT License - feel free to modify and use!
