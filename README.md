# Audio-Reactive Video Pipeline

The rendering engine behind [kliip.it](https://kliip.it/).

Render audio-reactive video from a **static image + audio file** using pluggable **GLSL shaders**. The pipeline analyzes audio via FFT, encodes it as a texture, then runs a fragment shader per-frame with the image and audio data as inputs. Frames are assembled into a final video with the original audio.

## How it works

```
pipeline.rb <shader.frag[,shader2.frag,...]> <image> <audio> [output.mp4]
  │
  ├── Step 1:  sox → audio_data.png
  │     Generates a monochrome spectrogram at 25 cols/sec.
  │     Result: Nx129 PNG (1 column per frame, 128 frequency bins)
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

### Positional arguments

All positional arguments are optional and have defaults:

```
ruby pipeline.rb [options] [shader(s)] [image] [audio] [output]
```

The shader argument accepts comma-separated paths for chaining (see [Shader chaining](#shader-chaining) below).

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
| `u_time` | `float` | `loc_time` | Current playback time in seconds (0.0 at first frame). |
| `u_duration` | `float` | `loc_duration` | Total audio duration in seconds. |

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

### Pass roles

A shader can run in one of three roles depending on how it's invoked. The role determines what `texture0` and `texture2` contain:

| Role | When | `texture0` | `texture2` | Output target |
|------|------|-----------|-----------|---------------|
| **`:state`** | First (or only) shader | Original image | Previous frame (ping-pong feedback) | Ping-pong buffer |
| **`:display`** | Auto-expanded `_display.frag` companion | Original image | Current state buffer | Chain buffer |
| **`:post`** | 2nd+ shader in a comma-separated chain | Previous pass output | Original image | Chain buffer |

Most single-purpose shaders only need to handle `:state`. If your shader is designed for post-processing chains (like `glitch.frag`), it works in `:post` role without modification — `texture0` just happens to be the previous shader's output instead of the source image.

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
VHS/VCR aesthetic: tape wobble, tracking lines, chromatic smearing, static noise, head switching artifacts. Bass drives wobble intensity, treble drives tracking speed.

https://github.com/user-attachments/assets/5a357b6f-01aa-445e-b373-33cf5fcd0313

### `shaders/glitch.frag` ([sample](samples/glitch.mp4))
Digital glitch: block displacement, RGB channel splits, noise corruption blocks, color quantization (bit crush). Treble triggers block displacement, bass drives large corruption. Works well as a `:post` shader in chains.



https://github.com/user-attachments/assets/be8a55ea-a782-453b-88af-c973fef9a629



### `shaders/domain_warp.frag` ([sample](samples/domain_warp.mp4))
Organic fluid distortion via layered fractal Brownian motion noise. Bass drives slow large-scale warping, treble drives finer detail. More subtle and atmospheric.



https://github.com/user-attachments/assets/5924f65b-5520-4853-9d4c-52583cd2431f



### `shaders/rutt_etra.frag` ([sample](samples/rutt_etra.mp4))
Rutt-Etra video synthesizer: horizontal scan lines are vertically displaced by image brightness, creating a 3D wireframe look. Bass widens line spacing for a heavier feel, mids thicken lines and speed up scroll, treble boosts color intensity. Loudness fills the gaps between scan lines with the underlying image.



https://github.com/user-attachments/assets/375872e0-33a3-4b86-99d3-40a9dc6261d6



### `shaders/vfield_sort.frag` + `vfield_sort_display.frag` ([sample](samples/vfield_sort.mp4))
Vector field pixel sort (port of ciphrd's Shadertoy, MIT). Three vector fields (horizontal bands, diagonal/quadrant, vertical split) are selected by audio loudness — quiet sections use simple horizontal sorting, loud sections use complex vertical splits. Sort direction flips when loudness crosses band boundaries (quantized into 0.10-wide bands, odd bands flip). The sort threshold is also modulated by loudness: more sorting during loud passages, less during quiet ones. Uses `texelFetch` for pixel-precise feedback — no interpolation drift across frames.



https://github.com/user-attachments/assets/e2f7dbee-363c-47f2-adba-1817c2f9f13b



## Architecture notes

### Why sox for audio analysis?

A single `sox spectrogram` call encodes the entire FFT analysis into one PNG texture. No streaming, no per-frame audio processing, no IPC. The shader just samples `texture1` at the right UV coordinate. This makes the pipeline stateless per-frame and trivially parallelizable.

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

The pipeline builds an ordered list of passes with three possible roles:

| Role | texture0 | texture1 | texture2 | Writes to |
|------|----------|----------|----------|-----------|
| `:state` (1st shader) | original image | audio | prev frame (ping-pong) | ping-pong buf |
| `:display` (auto-expanded `_display`) | original image | audio | current state buf | chain buf |
| `:post` (2nd+ shader) | previous pass output | audio | original image | chain buf |

`_display.frag` companions are auto-detected and inserted — you never list them explicitly. Examples:

| Input | Passes |
|-------|--------|
| `glitch.frag` | `[state]` — single pass, no extra buffers |
| `vfield_sort.frag` | `[state, display]` — auto-expanded, same as two-pass |
| `rutt_etra.frag,glitch.frag` | `[state, post]` — 2-pass chain |
| `vfield_sort.frag,glitch.frag` | `[state, display, post]` — 3-pass chain |

**Buffer allocation:** `buf_a`/`buf_b` (ping-pong) are always allocated. `chain_buf_a`/`chain_buf_b` are allocated only when there are multiple passes. Max 4 RenderTextures regardless of chain length.

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
├── audio_data.png                 # Generated: sox spectrogram (gitignored)
├── samples/                       # 5-second sample clips at peak audio reactivity
├── shaders/
│   ├── overdrive.frag             # Kitchen-sink: zoom, aberration, bloom, glitch, grain
│   ├── vcr_distortion.frag        # VHS tape degradation
│   ├── glitch.frag                # Digital block glitch
│   ├── domain_warp.frag           # Organic fluid warping
│   ├── rutt_etra.frag             # Rutt-Etra scanline displacement
│   ├── vfield_sort.frag           # Vector field pixel sort state pass (two-pass)
│   ├── vfield_sort_display.frag   # Vector field pixel sort display pass
│   └── README                     # Quick shader interface reference
└── README.md                      # This file
```

## License

MIT — see [LICENSE](LICENSE).
