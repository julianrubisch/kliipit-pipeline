#!/usr/bin/env ruby
# frozen_string_literal: true

require "bundler/inline"

gemfile do
  source "https://rubygems.org"
  gem "raylib-bindings", "~> 0.5"
end

require "raylib"
require "tmpdir"
require "tempfile"
require "fileutils"
require "yaml"

# Load raylib native library
shared_lib_path = Gem::Specification.find_by_name("raylib-bindings").full_gem_path + "/lib/"
arch = RUBY_PLATFORM.split("-")[0]
case RUBY_PLATFORM
when /darwin/
  Raylib.load_lib(shared_lib_path + "libraylib.#{arch}.dylib")
when /linux/
  Raylib.load_lib(shared_lib_path + "libraylib.#{arch}.so")
else
  abort "Unsupported platform: #{RUBY_PLATFORM}"
end

include Raylib

# --- Layer class ---
class Layer
  attr_reader :shader_path, :display_path, :has_display,
              :start, :end_time, :fade_in, :fade_out, :mode
  attr_accessor :state, :display,
                :buf_a, :buf_b, :current_buf, :prev_buf

  def initialize(shader:, start: nil, end_time: nil, fade_in: 0.0, fade_out: 0.0, mode: :blend)
    @shader_path = File.expand_path(shader)
    @display_path = @shader_path.sub(/\.frag$/, "_display.frag")
    @has_display = File.exist?(@display_path)
    @start = start&.to_f
    @end_time = end_time&.to_f
    @fade_in = fade_in.to_f
    @fade_out = fade_out.to_f
    @mode = mode.to_sym
  end

  def mix_at(time, duration)
    s = @start || 0.0
    e = @end_time || duration
    return 0.0 if time < s || time > e

    mix = 1.0
    mix = [(time - s) / @fade_in, 1.0].min if @fade_in > 0 && time < s + @fade_in
    mix = [(e - time) / @fade_out, mix].min if @fade_out > 0 && time > e - @fade_out
    mix.clamp(0.0, 1.0)
  end

  def active_at?(time, duration)
    s = @start || 0.0
    e = @end_time || duration
    time >= s && time <= e
  end

  def swap_buffers!
    @current_buf, @prev_buf = @prev_buf, @current_buf
  end

  def label
    name = File.basename(@shader_path)
    parts = ["#{name}(#{@mode}"]
    if @start || @end_time
      s = @start ? "#{@start}s" : "0"
      e = @end_time ? "#{@end_time}s" : "end"
      parts << " #{s}-#{e}"
    end
    parts << " fade_in=#{@fade_in}" if @fade_in > 0
    parts << " fade_out=#{@fade_out}" if @fade_out > 0
    parts << ")"
    parts.join
  end
end

# --- Parse options ---
require "optparse"

options = { fps: 25, start: 0.0, preview: false }
OptionParser.new do |opts|
  opts.banner = "Usage: pipeline.rb [options] [shader(s)] [image] [audio] [output]\n" \
                "       pipeline.rb [options] -c composition.yml [image] [audio] [output]"
  opts.on("-n", "--frames N", Integer, "Render only N frames")        { |n| options[:max_frames] = n }
  opts.on("-t", "--duration SECS", Float, "Render only SECS seconds") { |t| options[:max_duration] = t }
  opts.on("-s", "--start SECS", Float, "Start render at SECS into the audio") { |t| options[:start] = t }
  opts.on("--fps N", Integer, "Frames per second (default: 25)")     { |n| options[:fps] = n }
  opts.on("-w", "--width N", Integer, "Output width (auto-detect from image)") { |n| options[:width] = n }
  opts.on("-H", "--height N", Integer, "Output height (auto-detect from image)") { |n| options[:height] = n }
  opts.on("-p", "--preview", "Also render a 2s preview around loudest moment") { options[:preview] = true }
  opts.on("-c", "--composition FILE", "YAML composition file")        { |f| options[:composition] = f }
end.parse!

# --- Build layers and resolve args ---
if options[:composition]
  comp_path = File.expand_path(options[:composition])
  abort "Composition file not found: #{comp_path}" unless File.exist?(comp_path)
  comp = YAML.safe_load(File.read(comp_path), symbolize_names: true)
  abort "Composition file must have a 'layers' key" unless comp[:layers].is_a?(Array)
  layers = comp[:layers].map do |l|
    l[:end_time] = l.delete(:end) if l.key?(:end)
    Layer.new(**l)
  end
  IMAGE_PATH  = File.expand_path(ARGV[0] || "bifurcation_square.png")
  AUDIO_PATH  = File.expand_path(ARGV[1] || "bifurcation_v_2025-12-18.wav")
  OUTPUT_PATH = File.expand_path(ARGV[2] || "output.mp4")
else
  raw_shader_arg = ARGV[0] || "shaders/overdrive.frag"
  shader_entries = raw_shader_arg.split(",").map(&:strip).map { |s| File.expand_path(s) }
  layers = shader_entries.each_with_index.map do |path, idx|
    Layer.new(shader: path, mode: idx == 0 ? :blend : :post)
  end
  IMAGE_PATH  = File.expand_path(ARGV[1] || "bifurcation_square.png")
  AUDIO_PATH  = File.expand_path(ARGV[2] || "bifurcation_v_2025-12-18.wav")
  OUTPUT_PATH = File.expand_path(ARGV[3] || "output.mp4")
end

SCRIPT_DIR = File.dirname(File.expand_path(__FILE__))
FPS = options[:fps]

# Auto-detect image dimensions from PNG header if not explicitly set
unless options[:width] && options[:height]
  png_header = File.binread(IMAGE_PATH, 24)
  abort "#{IMAGE_PATH} is not a valid PNG" unless png_header[0, 4] == "\x89PNG".b
  img_w = png_header[16, 4].unpack1("N")
  img_h = png_header[20, 4].unpack1("N")
  options[:width]  ||= img_w
  options[:height] ||= img_h
  puts "==> Image: #{img_w}x#{img_h} (auto-detected)"
end

WIDTH = options[:width]
HEIGHT = options[:height]

# --- Step 0: Validate inputs ---
all_shader_paths = layers.flat_map { |l| [l.shader_path, l.has_display ? l.display_path : nil].compact }
(all_shader_paths + [IMAGE_PATH, AUDIO_PATH]).each do |f|
  abort "File not found: #{f}" unless File.exist?(f)
end

%w[sox soxi ffmpeg].each do |cmd|
  abort "#{cmd} not found in PATH" unless system("which #{cmd} > /dev/null 2>&1")
end

# --- Step 1: Audio analysis via sox ---
duration = `soxi -D "#{AUDIO_PATH}"`.strip.to_f
total_frames = (duration * FPS).to_i
audio_data_file = Tempfile.new(["audio_data", ".png"])
audio_data_path = audio_data_file.path

# Apply frame/duration limits (these limit the *duration*, not the absolute end)
if options[:max_frames]
  total_frames = [total_frames, options[:max_frames]].min
elsif options[:max_duration]
  total_frames = [total_frames, (options[:max_duration] * FPS).to_i].min
end

# Apply start offset
total_audio_frames = (duration * FPS).to_i
start_frame = [[((options[:start]) * FPS).to_i, 0].max, total_audio_frames].min
end_frame = [start_frame + total_frames, total_audio_frames].min
total_frames = end_frame - start_frame
render_duration = total_frames.to_f / FPS

puts "==> Audio: #{duration}s total, rendering #{total_frames} frames (#{render_duration}s) at #{FPS}fps, starting at #{options[:start]}s"
puts "==> Step 1: Generating audio data texture..."

# Ensure spectrogram width stays within GPU max texture size (typically 16384).
# Reduce pixels-per-second if the audio is too long.
max_texture_width = 16384
spectrogram_pps = FPS
spectrogram_width = (duration * spectrogram_pps).ceil
if spectrogram_width > max_texture_width
  spectrogram_pps = (max_texture_width / duration).floor
  puts "    Audio too long for #{FPS}px/s spectrogram (#{spectrogram_width} > #{max_texture_width}px)."
  puts "    Reducing to #{spectrogram_pps}px/s (GPU texture interpolation fills the gaps)."
end

system("sox", AUDIO_PATH, "-n", "remix", "-", "spectrogram",
       "-r", "-m", "-X", spectrogram_pps.to_s, "-y", "129", "-z", "96",
       "-o", audio_data_path, exception: true)

puts "    Created audio_data.png"

# Generate raw PCM waveform data for waveform texture
waveform_raw_file = Tempfile.new(["waveform_raw", ".pcm"])
waveform_raw_path = waveform_raw_file.path
puts "    Extracting raw PCM for waveform texture..."
system("sox", AUDIO_PATH, "-t", "raw", "-e", "signed-integer", "-b", "16",
       "-c", "1", "-r", "44100", waveform_raw_path, "remix", "-", exception: true)

preview_duration = 2.0
preview_frames = (preview_duration * FPS).to_i

# Preprocess shader: resolve #include directives
def preprocess_shader(path, include_dir)
  source = File.read(path)
  source.gsub(/#include\s+"([^"]+)"/) do
    inc_path = File.join(include_dir, $1)
    abort "Include not found: #{inc_path}" unless File.exist?(inc_path)
    File.read(inc_path)
  end
end

# Load a shader and return a hash with the shader and its uniform locations
def load_shader_with_locs(path, include_dir)
  source = preprocess_shader(path, include_dir)
  shader = LoadShaderFromMemory(nil, source)
  {
    shader: shader,
    loc_time: GetShaderLocation(shader, "u_time"),
    loc_duration: GetShaderLocation(shader, "u_duration"),
    loc_mix: GetShaderLocation(shader, "u_mix"),
    loc_tex1: GetShaderLocation(shader, "texture1"),
    loc_tex2: GetShaderLocation(shader, "texture2"),
    loc_tex3: GetShaderLocation(shader, "texture3"),
  }
end

# Init raylib with hidden window (needed for both preview and full render)
SetConfigFlags(FLAG_WINDOW_HIDDEN)
SetTraceLogLevel(LOG_ERROR)
InitWindow(WIDTH, HEIGHT, "pipeline")
SetTargetFPS(9999)

# Build waveform texture from raw PCM data
puts "    Building waveform texture..."
waveform_tex_height = 1024
raw_pcm = File.binread(waveform_raw_path)
pcm_samples = raw_pcm.unpack("s<*")  # signed 16-bit LE
total_pcm_samples = pcm_samples.length

# Width matches spectrogram so time axes align
waveform_tex_width = (duration * spectrogram_pps).ceil
waveform_tex_width = [waveform_tex_width, max_texture_width].min

pixels = Array.new(waveform_tex_width * waveform_tex_height, 128)
waveform_tex_width.times do |col|
  # Time range for this column
  t_start = (col.to_f / waveform_tex_width) * total_pcm_samples
  t_end = ((col + 1).to_f / waveform_tex_width) * total_pcm_samples
  slice_start = t_start.to_i
  slice_end = [t_end.to_i, total_pcm_samples].min
  slice_len = slice_end - slice_start

  next if slice_len <= 0

  waveform_tex_height.times do |row|
    # Map row to a sample index within this time slice
    sample_idx = slice_start + (row.to_f / waveform_tex_height * slice_len).to_i
    sample_idx = [sample_idx, total_pcm_samples - 1].min
    val = pcm_samples[sample_idx]
    # Map [-32768, 32767] -> [0, 255], 128 = zero crossing
    byte = ((val + 32768) * 255 / 65535.0).round
    byte = [[byte, 0].max, 255].min
    pixels[col + row * waveform_tex_width] = byte
  end
end

# Create raylib Image and load as texture
waveform_pixel_data = FFI::MemoryPointer.new(:uint8, pixels.length)
waveform_pixel_data.write_array_of_uint8(pixels)

waveform_image = Image.new
waveform_image[:data] = waveform_pixel_data
waveform_image[:width] = waveform_tex_width
waveform_image[:height] = waveform_tex_height
waveform_image[:mipmaps] = 1
waveform_image[:format] = PIXELFORMAT_UNCOMPRESSED_GRAYSCALE

waveform_tex = LoadTextureFromImage(waveform_image)
puts "    Waveform texture: #{waveform_tex_width}x#{waveform_tex_height}"

# Cleanup temp files
waveform_raw_file.close!

if options[:preview]
  # --- Step 1b: Find loudest moment for preview ---
  puts "==> Step 1b: Finding loudest moment for preview..."

  # Load the spectrogram to find peak loudness column
  spec_img = LoadImage(audio_data_path)
  spec_w = spec_img[:width]
  spec_h = spec_img[:height]

  loudest_col = 0
  loudest_energy = 0.0
  spec_w.times do |x|
    col_energy = 0.0
    spec_h.times do |y|
      c = GetImageColor(spec_img, x, y)
      col_energy += c[:r] / 255.0  # monochrome, so r=g=b
    end
    if col_energy > loudest_energy
      loudest_energy = col_energy
      loudest_col = x
    end
  end
  UnloadImage(spec_img)

  # Convert spectrogram column to time
  loudest_time = loudest_col.to_f / spectrogram_pps
  # Center the preview window around the loudest moment
  preview_start = [loudest_time - preview_duration / 2.0, 0.0].max
  preview_start = [preview_start, duration - preview_duration].min if duration > preview_duration
  preview_start_frame = (preview_start * FPS).to_i
  preview_end_frame = [preview_start_frame + preview_frames, total_audio_frames].min

  puts "    Loudest moment: #{loudest_time.round(2)}s — preview window: #{preview_start.round(2)}s–#{(preview_start + preview_duration).round(2)}s"
end

# --- Load resources ---
image_tex = LoadTexture(IMAGE_PATH)
audio_tex = LoadTexture(audio_data_path)
audio_data_file.close!

# Load shaders and allocate buffers for each layer
layers.each do |layer|
  layer.state = load_shader_with_locs(layer.shader_path, SCRIPT_DIR)
  SetShaderValue(layer.state[:shader], layer.state[:loc_duration], [duration].pack("f"), SHADER_UNIFORM_FLOAT)

  if layer.has_display
    layer.display = load_shader_with_locs(layer.display_path, SCRIPT_DIR)
    SetShaderValue(layer.display[:shader], layer.display[:loc_duration], [duration].pack("f"), SHADER_UNIFORM_FLOAT)
  end

  layer.buf_a = LoadRenderTexture(WIDTH, HEIGHT)
  layer.buf_b = LoadRenderTexture(WIDTH, HEIGHT)
  SetTextureFilter(layer.buf_a[:texture], TEXTURE_FILTER_POINT)
  SetTextureFilter(layer.buf_b[:texture], TEXTURE_FILTER_POINT)
  layer.current_buf = layer.buf_a
  layer.prev_buf = layer.buf_b
end

# Shared buffers for compositing and display passes
composite_buf = LoadRenderTexture(WIDTH, HEIGHT)
display_buf = layers.any?(&:has_display) ? LoadRenderTexture(WIDTH, HEIGHT) : nil

puts "    Layers: #{layers.map(&:label).join(" + ")}"

# --- Render helper ---
# Renders a range of frames using the layer pipeline.
# Yields frame index for progress reporting.
def render_frames(frame_range, frame_dir, fps, layers, image_tex, audio_tex, waveform_tex,
                  composite_buf, display_buf, width, height, audio_duration)
  src_rect = Rectangle.create(0, 0, image_tex[:width], image_tex[:height])
  dst_rect = Rectangle.create(0, 0, width, height)
  rt_src_rect = Rectangle.create(0, 0, width, -height)
  origin = Vector2.create(0, 0)

  # Initialize ping-pong buffers with source image for :blend layers
  layers.each do |layer|
    next unless layer.mode == :blend
    [layer.buf_a, layer.buf_b].each do |buf|
      BeginTextureMode(buf)
        ClearBackground(BLACK)
        DrawTexturePro(image_tex, src_rect, dst_rect, origin, 0, WHITE)
      EndTextureMode()
    end
    layer.current_buf = layer.buf_a
    layer.prev_buf = layer.buf_b
  end

  render_start = frame_range.first.to_f / fps

  frame_range.each_with_index do |i, idx|
    time = i.to_f / fps              # absolute time (for shader audio lookup)
    layer_time = time - render_start  # relative time (for layer mix/active)
    render_len = (frame_range.size).to_f / fps
    time_packed = [time].pack("f")

    # Clear composite for this frame
    BeginTextureMode(composite_buf)
      ClearBackground(BLACK)
    EndTextureMode()

    layers.each do |layer|
      next unless layer.active_at?(layer_time, render_len)
      mix = layer.mix_at(layer_time, render_len)
      mix_packed = [mix].pack("f")
      ps = layer.state

      # Set uniforms
      SetShaderValue(ps[:shader], ps[:loc_time], time_packed, SHADER_UNIFORM_FLOAT)
      SetShaderValue(ps[:shader], ps[:loc_mix], mix_packed, SHADER_UNIFORM_FLOAT) if ps[:loc_mix] >= 0

      # Render state pass
      BeginTextureMode(layer.current_buf)
        ClearBackground(BLACK)
        BeginShaderMode(ps[:shader])
          SetShaderValueTexture(ps[:shader], ps[:loc_tex1], audio_tex)
          SetShaderValueTexture(ps[:shader], ps[:loc_tex3], waveform_tex) if ps[:loc_tex3] >= 0
          case layer.mode
          when :blend
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], layer.prev_buf[:texture]) if ps[:loc_tex2] >= 0
            DrawTexturePro(image_tex, src_rect, dst_rect, origin, 0, WHITE)
          when :post
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], image_tex) if ps[:loc_tex2] >= 0
            DrawTextureRec(composite_buf[:texture], rt_src_rect, origin, WHITE)
          end
        EndShaderMode()
      EndTextureMode()

      # Render display pass if present
      output = layer.current_buf
      if layer.has_display
        dp = layer.display
        SetShaderValue(dp[:shader], dp[:loc_time], time_packed, SHADER_UNIFORM_FLOAT)
        SetShaderValue(dp[:shader], dp[:loc_mix], mix_packed, SHADER_UNIFORM_FLOAT) if dp[:loc_mix] >= 0
        BeginTextureMode(display_buf)
          ClearBackground(BLACK)
          BeginShaderMode(dp[:shader])
            SetShaderValueTexture(dp[:shader], dp[:loc_tex1], audio_tex)
            SetShaderValueTexture(dp[:shader], dp[:loc_tex2], layer.current_buf[:texture]) if dp[:loc_tex2] >= 0
            SetShaderValueTexture(dp[:shader], dp[:loc_tex3], waveform_tex) if dp[:loc_tex3] >= 0
            DrawTexturePro(image_tex, src_rect, dst_rect, origin, 0, WHITE)
          EndShaderMode()
        EndTextureMode()
        output = display_buf
      end

      # Composite: draw layer output onto composite with alpha = mix
      alpha = (mix * 255).round.clamp(0, 255)
      tint = Color.new
      tint[:r] = 255; tint[:g] = 255; tint[:b] = 255; tint[:a] = alpha
      BeginTextureMode(composite_buf)
        DrawTextureRec(output[:texture], rt_src_rect, origin, tint)
      EndTextureMode()

      layer.swap_buffers! if layer.mode == :blend
    end

    # Export composite
    img = LoadImageFromTexture(composite_buf[:texture])
    ImageFlipVertical(img)
    ExportImage(img, File.join(frame_dir, format("%05d.png", idx)))
    UnloadImage(img)

    yield idx if block_given?
  end
end

if options[:preview]
  # --- Step 2a: Render preview ---
  preview_path = OUTPUT_PATH.sub(/(\.\w+)$/, '_preview\1')
  preview_frame_dir = Dir.mktmpdir("av-preview")
  actual_preview_frames = preview_end_frame - preview_start_frame

  puts "==> Step 2a: Rendering #{actual_preview_frames}-frame preview..."

  last_pct = -1
  render_frames(preview_start_frame...preview_end_frame, preview_frame_dir, FPS,
                layers, image_tex, audio_tex, waveform_tex,
                composite_buf, display_buf, WIDTH, HEIGHT, duration) do |idx|
    pct = (idx * 100) / actual_preview_frames
    if pct != last_pct
      print "\r    [#{"#" * (pct / 2)}#{" " * (50 - pct / 2)}] #{pct}%"
      last_pct = pct
    end
  end
  puts "\r    [##################################################] 100%"

  # Mux preview with audio (offset to the loudest section)
  system("ffmpeg", "-y", "-v", "warning",
         "-framerate", FPS.to_s,
         "-start_number", "0",
         "-i", File.join(preview_frame_dir, "%05d.png"),
         "-ss", preview_start.to_s,
         "-i", AUDIO_PATH,
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "256k",
         "-shortest", preview_path,
         exception: true)

  FileUtils.rm_rf(preview_frame_dir)
  puts "    Preview: #{preview_path}"
end

# --- Step 2b: Render full video ---
puts "==> Step 2b: Rendering #{total_frames} frames..."

frame_dir = Dir.mktmpdir("av-frames")
last_pct = -1
render_frames(start_frame...end_frame, frame_dir, FPS,
              layers, image_tex, audio_tex, waveform_tex,
              composite_buf, display_buf, WIDTH, HEIGHT, duration) do |idx|
  pct = (idx * 100) / total_frames
  if pct != last_pct
    print "\r    [#{"#" * (pct / 2)}#{" " * (50 - pct / 2)}] #{pct}%"
    last_pct = pct
  end
end
puts "\r    [##################################################] 100%"

# Cleanup raylib
layers.each do |layer|
  UnloadShader(layer.state[:shader])
  UnloadShader(layer.display[:shader]) if layer.has_display
  UnloadRenderTexture(layer.buf_a)
  UnloadRenderTexture(layer.buf_b)
end
UnloadTexture(image_tex)
UnloadTexture(audio_tex)
UnloadTexture(waveform_tex)
UnloadRenderTexture(composite_buf)
UnloadRenderTexture(display_buf) if display_buf
CloseWindow()

puts "    Rendered #{total_frames} frames"

# --- Step 3: Assemble with ffmpeg ---
puts "==> Step 3: Encoding video..."

ffmpeg_cmd = ["ffmpeg", "-y",
       "-framerate", FPS.to_s,
       "-start_number", "0",
       "-i", File.join(frame_dir, "%05d.png")]
ffmpeg_cmd += ["-ss", (start_frame.to_f / FPS).to_s] if start_frame > 0
ffmpeg_cmd += ["-i", AUDIO_PATH,
       "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "256k",
       "-shortest", OUTPUT_PATH]
system(*ffmpeg_cmd, exception: true)

puts "==> Done: #{OUTPUT_PATH}"

# Cleanup
FileUtils.rm_rf(frame_dir)
puts "    Cleaned up temp frames"
