# Audio-Reactive Video Pipeline

The rendering engine behind [kliip.it](https://kliip.it/).

Render audio-reactive video from a **static image + audio file** using pluggable **GLSL shaders**. The pipeline analyzes audio via FFT, encodes it as a texture, then runs a fragment shader per-frame with the image and audio data as inputs. Frames are assembled into a final video with the original audio.

## How it works

```
pipeline.rb <shader.frag[,shader2.frag,...]> <image> <audio> [output.mp4]
  │
  ├── Step 1:  sox → audio_data.png + waveform texture
  │     Generates a monochrome spectrogram at 25 cols/sec (texture1).
  │     Also extracts raw PCM and builds a waveform texture (texture3).
  │     Result: Nx129 spectrogram + Nx1024 waveform grayscale
  │
  ├── Step 1b: (with -p) Find loudest moment → preview
  │     Scans the spectrogram for peak energy, renders a 2-second clip
  │     centered on that moment as <output>_preview.mp4.
  │
  ├── Step 2:  raylib (headless) → frame sequence
  │     Builds a pass list from the shader arg (auto-expands _display companions).
  │     Renders each pass per frame, chaining outputs. Exports the final pass as PNG.
  │
  └── Step 3:  ffmpeg → mux frames + original audio → output.mp4
```

### The audio data texture

Sox's `spectrogram` effect with `-r -m` (raw, monochrome) at `-X 25` (25 pixels/sec) generates a PNG where:

- **X axis** = time (1 pixel = 1 frame at 25fps)
- **Y axis** = frequency bins (0=low, 128=high)
- **Pixel brightness** = magnitude (0.0–1.0)

This encodes the full FFT analysis into a single texture — no per-frame audio piping needed. The shader samples it at `vec2(u_time / u_duration, frequency)` to read any frequency band at the current time.

## Requirements

### System dependencies

| Tool | Purpose | Install (macOS) | Install (Debian/Ubuntu) |
|------|---------|-----------------|-------------------------|
| **Ruby** (3.0+) | Pipeline runner | `brew install ruby` or rbenv/asdf | `sudo apt install ruby-full` or rbenv/asdf |
| **raylib** | GPU shader rendering | `brew install raylib` | `sudo apt install libraylib-dev` |
| **sox** | Audio analysis (FFT spectrogram) | `brew install sox` | `sudo apt install sox libsox-fmt-all` |
| **ffmpeg** | Video encoding | `brew install ffmpeg` | `sudo apt install ffmpeg` |

The `raylib-bindings` gem bundles its own raylib shared library, but system raylib may still be needed for some setups.

**Debian/Ubuntu one-liner:**

```bash
sudo apt install ruby-full libraylib-dev sox libsox-fmt-all ffmpeg
```

### Ruby dependencies

Handled automatically via `bundler/inline` — no Gemfile needed:

- `raylib-bindings` (~> 0.5) — Ruby FFI bindings to raylib

First run will auto-install the gem.

## Usage

```bash
# Full render (default shader: overdrive)
ruby pipeline.rb shaders/overdrive.frag image.png audio.wav output.mp4

# Quick 5-second preview
ruby pipeline.rb -t 5 shaders/glitch.frag image.png audio.wav preview.mp4

# Render 90 frames at half resolution
ruby pipeline.rb -n 90 -w 512 --height 512 shaders/overdrive.frag image.png audio.wav test.mp4

# Chain two shaders: rutt_etra state → glitch post-processing
ruby pipeline.rb shaders/rutt_etra.frag,shaders/glitch.frag image.png audio.wav output.mp4

# Three-pass chain: vfield_sort state → vfield_sort_display → glitch post
ruby pipeline.rb shaders/vfield_sort.frag,shaders/glitch.frag image.png audio.wav output.mp4

# Layered composition from YAML (see "Layer composition" below)
ruby pipeline.rb -c composition.yml image.png audio.wav output.mp4
```

Use `-p` to also generate a 2-second `_preview.mp4` at the loudest moment before rendering the full video.

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-n`, `--frames N` | Render only N frames | all |
| `-t`, `--duration SECS` | Render only SECS seconds | all |
| `-s`, `--start SECS` | Start render at SECS into the audio | 0 |
| `--fps N` | Frames per second | 25 |
| `-w`, `--width N` | Output width in pixels | from image |
| `-H`, `--height N` | Output height in pixels | from image |
| `-p`, `--preview` | Also render a 2s preview around loudest moment | off |
| `-c`, `--composition FILE` | YAML composition file for layered rendering | — |

### Positional arguments

All positional arguments are optional and have defaults:

```
ruby pipeline.rb [options] [shader(s)] [image] [audio] [output]
ruby pipeline.rb [options] -c composition.yml [image] [audio] [output]
```

The shader argument accepts comma-separated paths for chaining (see [Shader chaining](#shader-chaining) below). For multi-layer compositions with per-layer timing and fades, use `-c` with a YAML file (see [Layer composition](#layer-composition)).

## Shader API

This section is the complete contract between the pipeline and any third-party `.frag` file. A shader that follows this spec will work with the pipeline out of the box — no Ruby changes needed.

### Requirements

- **GLSL version**: `#version 330` (OpenGL 3.3 core profile)
- **Output**: write to `out vec4 finalColor` (RGBA, 0.0–1.0)
- **Coordinate system**: use `fragTexCoord` (0,0 = top-left, 1,1 = bottom-right) for UV; `gl_FragCoord` is also available

### Uniforms

The pipeline binds these uniforms automatically. Declare only the ones you use — unused uniforms are silently ignored.

| Name | Type | Binding | Description |
|------|------|---------|-------------|
| `texture0` | `sampler2D` | auto (raylib) | Source image. In a `:post` chain pass, this is the previous pass's output instead. |
| `texture1` | `sampler2D` | `loc_tex1` | Audio spectrogram texture (see [Audio data format](#audio-data-format)). |
| `texture2` | `sampler2D` | `loc_tex2` | Context-dependent — see [Pass roles](#pass-roles) below. |
| `texture3` | `sampler2D` | `loc_tex3` | Waveform PCM texture (see [Waveform data format](#waveform-data-format)). Optional — only needed by shaders that render raw waveforms. |
| `u_time` | `float` | `loc_time` | Current playback time in seconds (0.0 at first frame). |
| `u_duration` | `float` | `loc_duration` | Total audio duration in seconds. |
| `u_mix` | `float` | `loc_mix` | Layer mix/opacity (0.0–1.0). Computed from the layer's fade envelope. Always 1.0 for single-shader renders. Optional — shaders that don't declare it simply ignore it. |

### Vertex inputs

Provided by raylib's default vertex shader. Always available.

| Name | Type | Description |
|------|------|-------------|
| `fragTexCoord` | `vec2` | UV coordinates (0,0)–(1,1) |
| `fragColor` | `vec4` | Vertex color (always WHITE) |

### Audio data format

The audio texture (`texture1`) is a sox-generated monochrome spectrogram PNG:

- **X axis** = time, normalized as `u_time / u_duration` (0.0–1.0)
- **Y axis** = frequency, 0.0 = Nyquist (top), 1.0 = DC (bottom) — so sample with `1.0 - freq`
- **Channel**: `r` = `g` = `b` = magnitude (0.0–1.0). Use `.r`.
- **Resolution**: width = `duration * fps` columns (capped at 16384), height = 129 pixels (128 frequency bins + DC)

### Waveform data format

The waveform texture (`texture3`) contains raw PCM sample data for rendering authentic oscilloscope-style waveforms:

- **X axis** = time, normalized as `u_time / u_duration` (0.0–1.0), same resolution as the spectrogram
- **Y axis** = sample position within the time slice (1024 subsampled PCM values)
- **Channel**: `r` = amplitude, where 0.5 = zero crossing, 0.0 = -32768, 1.0 = +32767
- **Resolution**: width = spectrogram width (capped at 16384), height = 1024
- **Source**: mono mixdown at 44100 Hz, signed 16-bit LE, extracted via sox

To read the waveform amplitude at the current time:

```glsl
float pcm = texture(texture3, vec2(u_time / u_duration, uv.x)).r;
float amplitude = (pcm - 0.5) * 2.0;  // map back to -1.0 .. 1.0
```

Unlike `texture1` (spectrogram), which provides magnitude-only frequency data at coarse time resolution, `texture3` preserves the actual sample shape — irregular, organic, and suitable for waveform visualization.

### Audio helper functions

Include the shared helpers to avoid manual texture sampling:

```glsl
#include "audio_common.glsl"
```

| Function | Returns | Description |
|----------|---------|-------------|
| `getFrequency(float freq)` | `float` | Lowpass-filtered FFT magnitude at normalized frequency (0.0=DC, 1.0=Nyquist) |
| `getFrequencyRaw(float freq)` | `float` | Unsmoothed FFT magnitude — use for transient-sensitive effects |
| `getLoudness()` | `float` | Overall energy (average of 32 bins, lowpass filtered) |
| `getLoudnessAt(float time)` | `float` | Overall energy at an arbitrary time (unsmoothed) — for time-windowed decisions |
| `getBass()` | `float` | Low frequency energy (~0–660 Hz, 4 bins) |
| `getMids()` | `float` | Mid frequency energy (~660 Hz–4 kHz, 20 bins) |
| `getTreble()` | `float` | High frequency energy (4 kHz+, 40 bins) |

All return values in roughly 0.0–1.0 (depending on audio content). The lowpass filter averages over ~4 recent frames with exponential decay weighting; adjust `SMOOTH_WINDOW` / `SMOOTH_SAMPLES` in `audio_common.glsl` if needed.

**Direct sampling** (bypassing helpers):

```glsl
float mag = texture(texture1, vec2(u_time / u_duration, 1.0 - freq)).r;
```

### `#include` support

The pipeline preprocesses `#include "filename"` directives before compilation, resolving paths relative to the pipeline script directory. Use this for `audio_common.glsl` or your own shared utilities.

### Layer modes

Each layer runs in one of two modes. The mode determines what `texture0` and `texture2` contain:

| Mode | `texture0` | `texture2` | Use case |
|------|-----------|-----------|----------|
| **`:blend`** | Original source image | Previous frame (ping-pong feedback) | Independent effects, generative visuals |
| **`:post`** | Composite of all layers below | Original source image | Effects applied on top of the base |

If a layer has a `_display.frag` companion, it is auto-expanded: the state shader writes to the ping-pong buffer, and the display shader reads the state via `texture2` and produces the layer's visual output.

Most shaders work in `:blend` mode without modification. Effect shaders designed for post-processing (like `glitch.frag`, `domain_warp.frag`) also work in `:post` mode — `texture0` just happens to be the composite of layers below instead of the source image.

### Two-pass convention (`_display.frag`)

If your shader maintains temporal state via `texture2` feedback (e.g. pixel sorting, cellular automata), visual effects applied to the output will compound across frames. To avoid this, split into two files:

1. **`my_shader.frag`** — pure state logic, writes clean data to the ping-pong buffer
2. **`my_shader_display.frag`** — reads state from `texture2`, applies visual effects for export

The pipeline detects the `_display.frag` companion automatically. Users never need to reference it.

### Minimal template

```glsl
#version 330

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

void main() {
    vec2 uv = fragTexCoord;
    vec3 img = texture(texture0, uv).rgb;

    float loud = getLoudness();
    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();

    // --- Your effects here ---
    img *= 1.0 + loud * 0.5;

    finalColor = vec4(img, 1.0);
}
```

### Two-pass template

**`my_sort.frag`** (state pass):

```glsl
#version 330
in vec2 fragTexCoord;
uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio
uniform sampler2D texture2;  // previous frame state
uniform float u_time;
uniform float u_duration;
out vec4 finalColor;

#include "audio_common.glsl"

void main() {
    vec2 uv = fragTexCoord;
    vec4 prev = texture(texture2, uv);  // read previous state
    vec4 orig = texture(texture0, uv);  // read original image

    // --- Stateful logic (sorting, simulation, etc.) ---
    // Write clean state — no visual effects here
    finalColor = prev;  // replace with your logic
}
```

**`my_sort_display.frag`** (display pass):

```glsl
#version 330
in vec2 fragTexCoord;
uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio
uniform sampler2D texture2;  // current state from my_sort.frag
uniform float u_time;
uniform float u_duration;
out vec4 finalColor;

#include "audio_common.glsl"

void main() {
    vec2 uv = fragTexCoord;
    vec4 state = texture(texture2, uv);  // read state
    vec4 orig = texture(texture0, uv);   // read original

    // --- Visual effects that don't feed back ---
    finalColor = state;  // replace with your logic
}
```

### Porting from Shadertoy

| Shadertoy | This pipeline |
|-----------|---------------|
| `iChannel0` (image) | `texture0` |
| `iChannel1` (audio) | `texture1` via `getFrequency()` etc. |
| `iTime` | `u_time` |
| `iResolution.xy` | `vec2(textureSize(texture0, 0))` |
| `fragCoord.xy / iResolution.xy` | `fragTexCoord` |
| `fragColor = vec4(...)` | `finalColor = vec4(...)` |
| `texture2D(...)` | `texture(...)` |
| `#version` | Must be `#version 330` |
| `varying` | `in` |

Shadertoy's audio texture is 512x2 (row 0 = FFT, row 1 = waveform). This pipeline uses a sox-generated spectrogram (Nx129), so direct `texture(iChannel1, ...)` calls need adapting — use `getFrequency()` instead.

## Included shaders

### `shaders/overdrive.frag` ([sample](samples/overdrive.mp4))
Kitchen-sink effects: bass zoom pulse, chromatic aberration, bloom, color temperature shift (magenta on bass / cyan on treble), throbbing scan lines, horizontal glitch slices, invert flash on transients, breathing vignette, film grain. The default shader.

https://github.com/user-attachments/assets/e70ebf1f-3487-415a-9b73-75de639d7245

### `shaders/vcr_distortion.frag` ([sample](samples/vcr_distortion.mp4))
VHS/VCR aesthetic: tape wobble, tracking lines, chromatic smearing, static noise, head switching artifacts. Bass drives wobble intensity, treble drives tracking speed. Adapted from Tsoding's [VCR Distortion](https://www.shadertoy.com/view/ldjGzV) on Shadertoy.

https://github.com/user-attachments/assets/5a357b6f-01aa-445e-b373-33cf5fcd0313

### `shaders/glitch.frag` ([sample](samples/glitch.mp4))
Digital glitch: block displacement, RGB channel splits, noise corruption blocks, color quantization (bit crush). Treble triggers block displacement, bass drives large corruption. Works well as a `:post` shader in chains.



https://github.com/user-attachments/assets/be8a55ea-a782-453b-88af-c973fef9a629



### `shaders/domain_warp.frag` ([sample](samples/domain_warp.mp4))
Organic fluid distortion via layered fractal Brownian motion noise. Bass drives slow large-scale warping, treble drives finer detail. More subtle and atmospheric.



https://github.com/user-attachments/assets/5924f65b-5520-4853-9d4c-52583cd2431f



### `shaders/rutt_etra.frag` ([sample](samples/rutt_etra.mp4))
Rutt-Etra video synthesizer, adapted from [DdXfRj](https://www.shadertoy.com/view/DdXfRj) on Shadertoy. Horizontal scan lines are vertically displaced by image brightness, creating a 3D wireframe look. Bass widens line spacing for a heavier feel, mids thicken lines and speed up scroll, treble boosts color intensity. Loudness fills the gaps between scan lines with the underlying image.



https://github.com/user-attachments/assets/375872e0-33a3-4b86-99d3-40a9dc6261d6



### `shaders/vfield_sort.frag` + `vfield_sort_display.frag` ([sample](samples/vfield_sort.mp4))
Vector field pixel sort, ported from ciphrd's [Pixel sorting with vector field](https://www.shadertoy.com/view/3dXSzs) on Shadertoy (MIT license). Three vector fields (horizontal bands, diagonal/quadrant, vertical split) are selected by audio loudness — quiet sections use simple horizontal sorting, loud sections use complex vertical splits. Sort direction flips when loudness crosses band boundaries (quantized into 0.10-wide bands, odd bands flip). The sort threshold is also modulated by loudness: more sorting during loud passages, less during quiet ones. Uses `texelFetch` for pixel-precise feedback — no interpolation drift across frames.



https://github.com/user-attachments/assets/e2f7dbee-363c-47f2-adba-1817c2f9f13b



### `shaders/showfreqs.frag` ([sample](samples/showfreqs.mp4))
Frequency spectrum visualizer (bar graph). Displays FFT magnitude bins as vertical bars scrolling with time, similar to ffmpeg's `showfreqs` filter.



https://github.com/user-attachments/assets/176aa17a-77ca-419e-9407-a076638a81cd



### `shaders/showwaves.frag` ([sample](samples/showwaves.mp4))
Raw PCM waveform oscilloscope, similar to ffmpeg's `showwaves mode=line`. Uses `texture3` (waveform PCM data) to render the actual audio waveform shape — irregular and organic, not synthesized from frequency data. Vertical bars extend from center to amplitude with anti-aliased edges. Works well chained with post-processing shaders like `rutt_etra` or `domain_warp`.



https://github.com/user-attachments/assets/28e414ec-ce6e-485e-b306-f0182cc86219



### `shaders/radial_spectrum.frag` ([sample](samples/radial_spectrum.mp4))
Frequency bars arranged in a circular ring. 96 bars rotated around a center point, bar length driven by FFT magnitude at each frequency. Adapted from [4stfR8](https://www.shadertoy.com/view/4stfR8) on Shadertoy.

### `shaders/plasma_globe.frag` ([sample](samples/plasma_globe.mp4))
Volumetric raymarched plasma tendrils emanating from a central sphere. Ray count, brightness, and color driven by bass/mids/treble. Adapted from nimitz's [Plasma Globe](https://www.shadertoy.com/view/XsjXRm) on Shadertoy, via ArthurTent's [ShaderAmp fork](https://www.shadertoy.com/view/43GGDm). CC BY-NC-SA 3.0.

### `shaders/discoteq.frag` ([sample](samples/discoteq.mp4))
Neon animated lines with blur and glow reacting to the audio spectrum. Line displacement and color intensity driven by frequency bands across the full range. Adapted from [mlfBDX](https://www.shadertoy.com/view/mlfBDX) on Shadertoy (by wj). CC BY-NC-SA 3.0.

### `shaders/chaolotus.frag` ([sample](samples/chaolotus.mp4))
Chaotic mandala/lotus with organic symmetric shapes morphing and pulsing with music. Bass drives radial distortion, mids modulate angular frequency, treble controls color cycling. Adapted from [wstXW2](https://www.shadertoy.com/view/wstXW2) on Shadertoy.

### `shaders/audio_3d.frag` ([sample](samples/audio_3d.mp4))
Raymarched 3D cityscape of bars deformed by the audio spectrum. Camera orbits the scene; bar height, color, and glow intensity mapped to frequency pitch and overall volume. Nearby bars react to volume, distant bars to higher frequencies. Adapted from kishimisu's [3D Audio Visualizer](https://www.shadertoy.com/view/Dtj3zW) on Shadertoy. CC BY-NC-SA 4.0.

## Architecture notes

### Why sox for audio analysis?

A single `sox spectrogram` call encodes the entire FFT analysis into one PNG texture (`texture1`). A second sox pass extracts raw PCM and builds a waveform texture (`texture3`) for shaders that need actual sample data. No streaming, no per-frame audio processing, no IPC. The shader just samples the appropriate texture at the right UV coordinate. This makes the pipeline stateless per-frame and trivially parallelizable.

### Why raylib?

- Ruby FFI bindings exist (`raylib-bindings` gem)
- Supports offscreen rendering via `RenderTexture` + hidden window
- Full GLSL shader support with custom uniforms
- Cross-platform (macOS, Linux)
- No dependency on X11/Wayland on macOS
- Simpler than raw OpenGL bindings

### Two-pass shaders (temporal feedback)

Shaders can access the previous frame via `texture2` (ping-pong buffer). If a shader has a companion `_display.frag` file (e.g. `vfield_sort.frag` + `vfield_sort_display.frag`), the pipeline auto-expands it into two passes:

1. **State pass** (`vfield_sort.frag`): writes clean sort/feedback state to the ping-pong buffer
2. **Display pass** (`vfield_sort_display.frag`): reads the state via `texture2`, applies visual effects, exports the frame

This prevents color/brightness changes from compounding across frames. The `_display` convention works transparently whether the shader is used alone or as the first shader in a chain.

### Shader chaining

Multiple shaders can be chained so one shader's output feeds into the next ([sample](samples/rutt_etra_glitch.mp4)). Pass comma-separated paths as the first argument:

```bash
ruby pipeline.rb shaders/rutt_etra.frag,shaders/glitch.frag image.png audio.wav
```

Internally, comma-separated shaders become layers: the first as `:blend` (renders from source image), the rest as `:post` (each processes the composite of layers below it). This is equivalent to the old sequential pass chain.

### Layer composition

For multi-layer compositions with per-layer timing, fades, and crossfades, use a YAML composition file with `-c`:

```bash
ruby pipeline.rb -c composition.yml image.png audio.wav output.mp4
```

Each layer renders independently and is composited bottom-to-top. Layers support two modes:

| Mode | Input | Compositing | Use for |
|------|-------|-------------|---------|
| `:blend` (default) | Original source image | Alpha-blended onto composite | Independent effects, generative visuals |
| `:post` | Composite of all layers below | Dry/wet mixed onto composite | Effects applied on top of the base |

**Layer properties:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `shader` | string | required | Path to `.frag` file |
| `mode` | string | `blend` | `blend` or `post` |
| `start` | float | 0 | Layer start time (seconds, relative to render window) |
| `end` | float | full duration | Layer end time (seconds, relative to render window) |
| `fade_in` | float | 0 | Fade-in duration (seconds) |
| `fade_out` | float | 0 | Fade-out duration (seconds) |

**Example: overdrive background with rutt_etra and domain_warp crossfading on top** ([sample](samples/layered_demo.mp4))

```yaml
# composition.yml
layers:
  - shader: shaders/overdrive.frag
    # Background — always on, full duration

  - shader: shaders/rutt_etra.frag
    mode: post
    end: 7.0
    fade_in: 1.5
    fade_out: 2.0

  - shader: shaders/domain_warp.frag
    mode: post
    start: 5.0
    fade_in: 2.0
    fade_out: 1.5
```

Timeline:

```
0s    1.5s          5s    7s           10.5s  12s
|--overdrive (background, always on)----------|
|fade|--rutt_etra---|fade_out|
                |fade_in|-----domain_warp-|f.o|
```

- **0–1.5s**: overdrive only, rutt_etra fading in
- **1.5–5s**: overdrive + full rutt_etra
- **5–7s**: overdrive + rutt_etra fading out + domain_warp fading in
- **7–10.5s**: overdrive + full domain_warp
- **10.5–12s**: overdrive + domain_warp fading out

The `:post` mode is key here — each overlay processes the overdrive output, and the fade envelope controls the dry/wet mix. At `mix=0` the overlay has no effect; at `mix=1` the effect is fully applied.

**Buffer allocation:** Each layer gets its own ping-pong pair (`buf_a`/`buf_b`), plus one shared `composite_buf` and one `display_buf` (if any layer has a `_display.frag` companion).



https://github.com/user-attachments/assets/2cb821b4-e082-4335-887f-9283261b4b9a



### Preview rendering

With `-p`/`--preview`, the pipeline scans the spectrogram for the column with the highest total energy and renders a 2-second clip centered on that moment before the full render. The preview is saved as `<output>_preview.mp4` with the matching audio segment. This lets you spot-check the shader at peak audio intensity without waiting for a full render.

### Frame export bottleneck

The main bottleneck is PNG export — `LoadImageFromTexture` + `ExportImage` per frame. For a 9-minute video at 1024x1024, expect ~16,000 frames. Potential optimizations:

- Pipe raw RGB directly to ffmpeg via stdin (skip PNG entirely)
- Use a lower resolution for previews (`-w 512 --height 512`)
- Use `-n` / `-t` flags for quick tests
- Reduce CRF or use `-preset ultrafast` for faster encoding

## File structure

```
├── pipeline.rb                    # Main pipeline script (Ruby + bundler/inline)
├── audio_common.glsl              # Shared audio helper functions
├── samples/                       # 5-second sample clips at peak audio reactivity
├── shaders/
│   ├── overdrive.frag             # Kitchen-sink: zoom, aberration, bloom, glitch, grain
│   ├── vcr_distortion.frag        # VHS tape degradation
│   ├── glitch.frag                # Digital block glitch
│   ├── domain_warp.frag           # Organic fluid warping
│   ├── rutt_etra.frag             # Rutt-Etra scanline displacement
│   ├── showfreqs.frag             # Frequency spectrum bar graph
│   ├── showwaves.frag             # Raw PCM waveform oscilloscope (uses texture3)
│   ├── radial_spectrum.frag       # Circular frequency bar ring (Shadertoy 4stfR8)
│   ├── plasma_globe.frag          # Volumetric plasma tendrils (Shadertoy XsjXRm)
│   ├── discoteq.frag              # Neon animated lines (Shadertoy mlfBDX)
│   ├── chaolotus.frag             # Chaotic mandala (Shadertoy wstXW2)
│   ├── audio_3d.frag              # Raymarched 3D bar city (Shadertoy Dtj3zW)
│   ├── vfield_sort.frag           # Vector field pixel sort state pass (two-pass)
│   ├── vfield_sort_display.frag   # Vector field pixel sort display pass
│   └── README                     # Quick shader interface reference
└── README.md                      # This file
```

## Acknowledgments

- **Rutt-Etra** — adapted from [DdXfRj](https://www.shadertoy.com/view/DdXfRj) on Shadertoy
- **VCR Distortion** — adapted from [ldjGzV](https://www.shadertoy.com/view/ldjGzV) by Tsoding on Shadertoy
- **Pixel sorting with vector field** — ported from [3dXSzs](https://www.shadertoy.com/view/3dXSzs) by ciphrd on Shadertoy (MIT license)
- **Radial Spectrum** — adapted from [4stfR8](https://www.shadertoy.com/view/4stfR8) on Shadertoy
- **Plasma Globe** — adapted from [XsjXRm](https://www.shadertoy.com/view/XsjXRm) by nimitz on Shadertoy, via ArthurTent's [ShaderAmp fork](https://www.shadertoy.com/view/43GGDm) (CC BY-NC-SA 3.0)
- **Discoteq** — adapted from [mlfBDX](https://www.shadertoy.com/view/mlfBDX) by wj on Shadertoy (CC BY-NC-SA 3.0)
- **Chaolotus** — adapted from [wstXW2](https://www.shadertoy.com/view/wstXW2) on Shadertoy
- **3D Audio Visualizer** — adapted from [Dtj3zW](https://www.shadertoy.com/view/Dtj3zW) by kishimisu on Shadertoy (CC BY-NC-SA 4.0)

## License

The pipeline code (`pipeline.rb`) and original shaders are MIT — see [LICENSE](LICENSE).

**Ported Shadertoy shaders have their own licenses** and are not covered by the MIT license:

| Shader | License | Commercial use |
|--------|---------|----------------|
| `overdrive.frag` | MIT | Yes |
| `glitch.frag` | MIT | Yes |
| `domain_warp.frag` | MIT | Yes |
| `showwaves.frag` | MIT | Yes |
| `showfreqs.frag` | MIT | Yes |
| `vfield_sort.frag` | MIT (ciphrd) | Yes |
| `rutt_etra.frag` | CC BY-NC-SA 3.0 | No |
| `vcr_distortion.frag` | CC BY-NC-SA 3.0 | No |
| `radial_spectrum.frag` | CC BY-NC-SA 3.0 | No |
| `plasma_globe.frag` | CC BY-NC-SA 3.0 (nimitz) | No |
| `discoteq.frag` | CC BY-NC-SA 3.0 (wj) | No |
| `chaolotus.frag` | CC BY-NC-SA 3.0 | No |
| `audio_3d.frag` | CC BY-NC-SA 4.0 (kishimisu) | No |

Shaders marked CC BY-NC-SA require attribution (included in each file's header) and prohibit commercial use. See the individual shader files for full license text and original author links.
