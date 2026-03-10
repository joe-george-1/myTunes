# myTunes

![myTunes Screenshot](https://raw.githubusercontent.com/nicbarker/myTunes/main/preview.png) *(Add a screenshot here later)*

**myTunes** is a beautiful, highly-customizable desktop audio player built with Rust and Tauri. It features a unique multi-window "gel" interface reminiscent of the early 2000s, but powered by modern web technologies. 

It is completely skinnable, transparent, and built to treat music playback as a visually rich desktop experience.

## Features

- **Multi-Window Gel UI**: The Player, Browser, Playlist, Visualizer, and Settings are all distinct borderless windows that can be dragged independently around your desktop.
- **Pixel-Perfect Skinnability**: Swap skins on the fly using simple PNG images. The application mathematically conforms to the transparent edges of your skins.
- **Compositor Native**: Integrates with Windows, macOS, and Linux desktop compositors to ensure crisp transparency without visual overlapping.
- **Local Audio Support**: Natively plays back standard audio formats (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, etc.) directly from your file system.
- **Cross-Platform Support**: Registers flawlessly as your default audio application on Mac, PC, and Linux.
- **System Resource Friendly**: Powered by a Rust backend, consuming minimal RAM and CPU while delivering maximum aesthetics.

## Installation

*Pre-compiled, 1-click installers for **macOS, Windows, and Linux** are coming soon.*

Until releases are published, you can compile and run it locally:

### Prerequisites

You will need the standard Tauri build environment setup for your OS:
- Node.js
- Rust (`cargo`)
- OS-specific build dependencies (C++ build tools on Windows, Xcode on macOS, WebKitGTK/libsoup on Linux).

### Running Locally

```bash
# Clone the repository
git clone https://github.com/yourusername/myTunes.git
cd myTunes

# Install frontend dependencies
npm install

# Run the development server
npm run tauri dev
```

### Building for Release

To compile a native binary for your operating system:

```bash
npm run tauri build
```

The compiled installers will be located in `src-tauri/target/release/bundle/`.

## Custom Skins
Adding your own skins is as simple as creating a folder in the `skins/` directory and dropping in PNGs named `player.png`, `browser.png`, `playlist.png`, `settings.png`, and `visualizer.png`. 

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*Made with Claude Opus 4.6 and Gemini 3.1 — March 2026*
