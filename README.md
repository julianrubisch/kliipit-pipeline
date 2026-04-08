# KliipitPipeline

The rendering engine behind [kliip.it](https://kliip.it/).

Render audio-reactive video from a **static image + audio file** using pluggable **GLSL shaders**. The pipeline analyzes audio via FFT, encodes it as a texture, then runs a fragment shader per-frame with the image and audio data as inputs. Frames are assembled into a final video with the original audio.

Audio decoding and spectrogram computation are handled by a **Rust native extension** using [symphonia](https://github.com/pdeljanov/Symphonia) and [rustfft](https://github.com/ejmahler/RustFFT) with [rayon](https://github.com/rayon-rs/rayon) parallelism — no sox dependency required.

## Installation

### System dependencies

| Tool | Purpose | Install (macOS) | Install (Debian/Ubuntu) |
|------|---------|-----------------|-------------------------|
| **Ruby** (3.1+) | Runtime | `brew install ruby` or rbenv/asdf | `sudo apt install ruby-full` or rbenv/asdf |
| **Rust** | Compiles native extension on install | `brew install rust` or [rustup](https://rustup.rs) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **ffmpeg** | Video encoding | `brew install ffmpeg` | `sudo apt install ffmpeg` |

### Gem install

```bash
gem install kliipit_pipeline
```

This compiles the Rust extension automatically. The `raylib-bindings` gem (bundled raylib) is pulled in as a dependency.

### From source

```bash
git clone https://github.com/julianrubisch/kliipit-pipeline.git
cd kliipit-pipeline
bundle install
bundle exec rake compile
```

## Usage

### CLI

```bash
# Full render (default shader: overdrive)
kliipit-pipeline overdrive.frag image.png audio.wav output.mp4

# Quick 5-second preview
kliipit-pipeline -t 5 glitch.frag image.png audio.wav preview.mp4

# Preview at loudest moment
kliipit-pipeline -p overdrive.frag image.png audio.wav output.mp4

# Chain two shaders
kliipit-pipeline rutt_etra.frag,glitch.frag image.png audio.wav output.mp4

# Layered composition from YAML
kliipit-pipeline -c composition.yml image.png audio.wav output.mp4
```

Shader names without a path are resolved from bundled shaders automatically.

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

### Library API

```ruby
require "kliipit_pipeline"

layers = [
  KliipitPipeline::Layer.new(shader: "overdrive.frag"),
  KliipitPipeline::Layer.new(shader: "glitch.frag", mode: :post)
]

pipeline = KliipitPipeline::Pipeline.new(
  audio_path: "audio.wav",
  image_path: "image.png",
  output_path: "output.mp4",
  layers: layers,
  fps: 25,
  preview: true
) { |event, *args| puts "#{event}: #{args}" }

pipeline.run!
```

## Shader API

- **GLSL version**: `#version 330`
- **Output**: `out vec4 finalColor`

### Uniforms

| Name | Type | Description |
|------|------|-------------|
| `texture0` | `sampler2D` | Source image (or previous pass output in `:post` mode) |
| `texture1` | `sampler2D` | Audio spectrogram texture |
| `texture2` | `sampler2D` | Previous frame (`:blend`) or source image (`:post`) |
| `texture3` | `sampler2D` | Waveform PCM texture (optional) |
| `u_time` | `float` | Current playback time (seconds) |
| `u_duration` | `float` | Total audio duration (seconds) |
| `u_mix` | `float` | Layer opacity (0.0–1.0) from fade envelope |

### Audio helpers

```glsl
#include "audio_common.glsl"

float bass = getBass();
float mids = getMids();
float treble = getTreble();
float loud = getLoudness();
float freq = getFrequency(0.5); // normalized frequency
```

## Included shaders

### Displacement

| Shader | Description |
|--------|-------------|
| `domain_warp.frag` | Organic fluid distortion via layered fBm noise |
| `luma_displace.frag` | Image displaces itself by brightness |
| `noise_warp.frag` | Damped sine waves from multiple epicenters |
| `ripple_displace.frag` | Concentric wave displacement from center |
| `twirl.frag` | Spiral vortex distortion |
| `cartopol.frag` | Cartesian-to-polar coordinate remap |
| `kaleidoscope.frag` | Angular folding into symmetric segments |
| `tile_mosaic.frag` | Tile subdivision with posterization |
| `feedback_rota.frag` | Rotation + zoom temporal feedback |

### Effects

| Shader | Description |
|--------|-------------|
| `overdrive.frag` | Kitchen-sink: zoom, aberration, bloom, scanlines, grain |
| `glitch.frag` | Digital block glitch with channel splits |
| `vcr_distortion.frag` | VHS/VCR tape degradation aesthetic |
| `vfield_sort.frag` | Vector field pixel sorting (two-pass) |

### Generative

| Shader | Description |
|--------|-------------|
| `morphblob.frag` | Morphing dark shape with pseudo-3D lighting |
| `chaolotus.frag` | Chaotic mandala with organic shapes |
| `discoteq.frag` | Neon animated lines with blur and glow |
| `gloop.frag` | Layered sine/cosine plasma interference |
| `interference.frag` | Moiré patterns from multiple sine sources |
| `noise_terrain.frag` | fBm noise rendered as pseudo-3D heightmap |
| `audio_3d.frag` | Raymarched 3D cityscape of spectrum bars |

### Visualizers

| Shader | Description |
|--------|-------------|
| `showfreqs.frag` | FFT frequency spectrum bar graph |
| `showwaves.frag` | Raw PCM waveform oscilloscope |
| `radial_spectrum.frag` | Circular frequency bar ring |
| `spectrum_ring.frag` | Rotating radar-sweep spectrum with trails |

## Layer composition

```yaml
layers:
  - shader: overdrive.frag

  - shader: rutt_etra.frag
    mode: post
    end: 7.0
    fade_in: 1.5
    fade_out: 2.0

  - shader: domain_warp.frag
    mode: post
    start: 5.0
    fade_in: 2.0
```

## Architecture

### Rust native extension

| Function | Description |
|----------|-------------|
| `decode_audio` | Decodes WAV/FLAC/MP3/OGG/AAC via symphonia to mono PCM |
| `compute_spectrogram` | STFT with Hann window, parallelized per-column via rayon |
| `build_waveform_texture` | Maps PCM to grayscale texture, parallelized per-column |
| `find_loudest_column` | Parallel column energy scan for preview targeting |

## License

The pipeline code and original shaders are MIT — see [LICENSE](LICENSE.txt).

**Ported Shadertoy shaders have their own licenses** — see individual shader files for details. Shaders marked CC BY-NC-SA require attribution and prohibit commercial use.
