# myTunes Window Dimension Audit

## Problem
Windows (Playlist, Visualizer, Settings) are appearing stretched/elongated in screenshots despite having correct numerical values in `tauri.conf.json`.

## Analysis
Comparing the user's provided dimensions with the visual aspect ratio in screenshots:
- **Player**: User says 380x530 (Tall). Screenshot: Tall. **OK.**
- **Browser**: User says 400x500 (Tall). Screenshot: Tall. **OK.**
- **Playlist**: User says 350x560 (Tall). Screenshot: **Wide Banner.**
- **Visualizer**: User says 440x350 (Wide). Screenshot: **Tall Portrait.**
- **Settings**: User says 380x530 (Tall). Screenshot: **Wide Banner.**

## Hypothesis
The values for Playlist, Visualizer, and Settings were swapped in the user's report (or my interpretation of them as WxH). Swapping them back should align the window frames with the skin assets.

## Action
- Swap Playlist to **560 x 350**.
- Swap Visualizer to **350 x 440**.
- Swap Settings to **530 x 380**.
