# Retrowave Visualizer

The old media player visualizations, back again. Play music on YouTube or YouTube Music and the visuals take over the video window, moving to the beat.

There are two ways to use it:

| | What it does | Best for |
|---|---|---|
| **Browser extension** (`extension/`) | Draws the visuals right on top of the YouTube player. It starts on its own when music plays. | Everyday listening on youtube.com and music.youtube.com |
| **Web page** (`index.html`) | A full-window visualizer. Share a YouTube tab's audio with it, open an audio file, use the mic, or play the built-in demo beat. | A second monitor, a TV, or a party screen |

## Visualizations

1. **Spectrum Bars**: LED-style equalizer bars with falling peak caps and a floor reflection
2. **Ocean Scope**: glowing oscilloscope waves with misty trails
3. **Feedback Tunnel**: the shape at the center gets pulled outward, zoomed and spun, frame after frame
4. **Starburst**: bursts of particles on every kick drum, plus a warp-speed star field
5. **Ambient Swirl**: slow, dreamy ribbons
6. **Kaleidoscope**: the spectrum mirrored into eight spinning wedges
7. **Halo**: a ring of spectrum bars around a pulsing waveform core
8. **Terrain**: a scrolling 3D landscape of the spectrum over time

By default a new visualization is picked every 30 seconds.

## Install the extension (Chrome, Edge, Brave, Opera)

1. Download this repo (**Code → Download ZIP**) and unzip it.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the `extension` folder.
5. Reload any YouTube tabs that are already open.

### Using it

- **Starts on its own** when a music video plays (you can change this in the toolbar popup).
- **Equalizer button** in the YouTube player's control bar (bottom right), or in the YouTube Music player bar: show or hide the visuals.
- **Keyboard:** `V` shows or hides it, `[` / `]` go to the previous / next visualization.
- Move the mouse over the player for previous / random / next / close buttons.
- Click the toolbar icon for settings: auto-start (music only, every video, or never), the visualization, cycle timing, and **Replace the video** vs **Blend over the video**.

"Is this music?" is a best guess. On youtube.com it looks at the video's category, "- Topic" and VEVO channels, "Provided to YouTube by" descriptions, and titles like "Official Video" or "Lyrics". On music.youtube.com, everything counts as music. If a song doesn't start the visuals on its own, press `V`.

### How it works

The extension routes the YouTube `<video>` element's sound through the Web Audio API (`createMediaElementSource` → `AnalyserNode` → speakers). It reads frequency and waveform data 60 times a second and draws on a `<canvas>` laid over the player. Your audio keeps playing through the speakers as normal. No data leaves your browser, and the only permission it asks for is `storage`, to save your settings.

Browsers won't let a page start audio processing until you've clicked or pressed a key. If auto-start fires before that, you'll see "Click anywhere on the page to connect the audio". One click and it connects.

## Use the web page

Open `index.html` in Chrome or Edge, or host it anywhere static, like GitHub Pages. Then choose a source:

- **Share a YouTube tab**: pick the YouTube tab in the share picker and turn on **Share tab audio**. The visuals follow whatever that tab plays.
- **Play the sample song**: a bundled instrumental track, good for a quick look. This needs the hosted page; opened straight from your disk, use **Open an audio file** and pick `samples/voxel-revolution.mp3` instead.
- **Open an audio file**, **Microphone**, or **Demo beat**.

Keys: `[` / `]` change the visualization, `F` or a double-click goes full screen, `M` opens the source menu, `1`–`8` jump to a visualization.

### On a TV (smart TV browser, Fire TV, Android TV)

Open the hosted page in the TV's web browser and use the remote:

| Remote button | What it does |
|---|---|
| Arrows + **OK** | Pick a source in the menu (the selected button gets a yellow outline) |
| ◀ ▶ while playing | Previous / next visualization |
| **OK** or ▲ ▼ while playing | Show the control bar; arrows move along it, OK presses a button |
| **Back** | Hide the control bar, then open the source menu |
| Play/Pause | Pause or resume the song |
| Channel +/–, ⏭ ⏮ | Next / previous visualization |
| Number keys 1–8 | Jump straight to a visualization |
| Red / Green / Yellow / Blue | Random visual / auto-change on-off / full screen / menu |

The control bar hides itself after 5 seconds. TV browsers can't share another tab or app's audio, so on a TV use **Play the sample song** or **Open an audio file**; those options are hidden when the browser can't support them. To visualize YouTube on the TV, run the page on a computer with **Share a YouTube tab** and mirror or cast that screen to the TV.

## Files

```
index.html               standalone web visualizer
samples/                 bundled sample song (see Credits)
extension/
  manifest.json          Manifest V3 extension
  visualizer.js          visualization engine + all presets (shared with index.html)
  content.js             hooks YouTube's player, overlay, button, auto-start
  content.css            overlay styling
  popup.html / popup.js  settings popup
  icons/                 extension icons
```

### Adding your own visualization

Add an entry to the `PRESETS` array in `extension/visualizer.js`:

```js
{
  name: 'My Visual',
  create() {
    // per-instance state goes here
    return {
      draw(g, f, { w, h, dt }) {
        // g: CanvasRenderingContext2D (CSS-pixel units)
        // f.freq / f.wave: raw analyser data; f.bands(n): n log-spaced levels 0..1
        // f.bass, f.mid, f.treble, f.level: 0..1; f.beat: true on a kick; f.beatPulse: decays from 1
      },
    };
  },
},
```

The visualizations here are original works made in the spirit of the classic media player visualizers.

## Credits

Sample song: “Voxel Revolution” by Kevin MacLeod ([incompetech.com](https://incompetech.com)).
Licensed under [Creative Commons: By Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
