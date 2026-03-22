#!/usr/bin/env ruby
# frozen_string_literal: true

require "bundler/inline"

gemfile do
  source "https://rubygems.org"
  gem "raylib-bindings", "~> 0.5"
end

require "raylib"
require "tmpdir"
require "fileutils"

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

# --- Parse options ---
require "optparse"

options = { fps: 25, width: 1024, height: 1024, start: 0.0 }
OptionParser.new do |opts|
  opts.banner = "Usage: pipeline.rb [options] [shader] [image] [audio] [output]"
  opts.on("-n", "--frames N", Integer, "Render only N frames")        { |n| options[:max_frames] = n }
  opts.on("-t", "--duration SECS", Float, "Render only SECS seconds") { |t| options[:max_duration] = t }
  opts.on("-s", "--start SECS", Float, "Start render at SECS into the audio") { |t| options[:start] = t }
  opts.on("--fps N", Integer, "Frames per second (default: 25)")     { |n| options[:fps] = n }
  opts.on("-w", "--width N", Integer, "Output width (default: 1024)") { |n| options[:width] = n }
  opts.on("-H", "--height N", Integer, "Output height (default: 1024)") { |n| options[:height] = n }
end.parse!

# --- Args (resolve to absolute paths before raylib changes CWD) ---
raw_shader_arg = ARGV[0] || "shaders/overdrive.frag"
shader_entries = raw_shader_arg.split(",").map(&:strip).map { |s| File.expand_path(s) }

passes = []
shader_entries.each_with_index do |path, idx|
  display_path = path.sub(/\.frag$/, "_display.frag")
  has_display = File.exist?(display_path)

  passes << { path: path, role: idx == 0 ? :state : :post }
  passes << { path: display_path, role: :display } if has_display && idx == 0
  passes << { path: display_path, role: :post } if has_display && idx > 0
end

SHADER_PATH = shader_entries.first  # keep for log messages
IMAGE_PATH  = File.expand_path(ARGV[1] || "bifurcation_square.png")
AUDIO_PATH  = File.expand_path(ARGV[2] || "bifurcation_v_2025-12-18.wav")
OUTPUT_PATH = File.expand_path(ARGV[3] || "output.mp4")

SCRIPT_DIR = File.dirname(File.expand_path(__FILE__))
FPS = options[:fps]
WIDTH = options[:width]
HEIGHT = options[:height]

# --- Step 0: Validate inputs ---
(passes.map { |p| p[:path] } + [IMAGE_PATH, AUDIO_PATH]).each do |f|
  abort "File not found: #{f}" unless File.exist?(f)
end

%w[sox soxi ffmpeg].each do |cmd|
  abort "#{cmd} not found in PATH" unless system("which #{cmd} > /dev/null 2>&1")
end

# --- Step 1: Audio analysis via sox ---
duration = `soxi -D "#{AUDIO_PATH}"`.strip.to_f
total_frames = (duration * FPS).to_i
audio_data_path = File.join(SCRIPT_DIR, "audio_data.png")

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

# --- Step 1b: Find loudest moment for preview ---
# Read the spectrogram PNG to find the column (frame) with the highest total energy.
# Each column is one time step; sum all frequency bins to get overall loudness.
puts "==> Step 1b: Finding loudest moment for preview..."

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

# Init raylib with hidden window (needed for both preview and full render)
SetConfigFlags(FLAG_WINDOW_HIDDEN)
SetTraceLogLevel(LOG_ERROR)
InitWindow(WIDTH, HEIGHT, "pipeline")
SetTargetFPS(9999)

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

# --- Render helper ---
# Renders a range of frames using the pass_shaders pipeline.
# Yields frame index for progress reporting.
def render_frames(frame_range, frame_dir, fps, pass_shaders, image_tex, audio_tex,
                  buf_a, buf_b, chain_buf_a, chain_buf_b, width, height)
  current_buf = buf_a
  prev_buf = buf_b

  # Re-initialize ping-pong buffers with source image (scaled to render target)
  src_rect = Rectangle.create(0, 0, image_tex[:width], image_tex[:height])
  dst_rect = Rectangle.create(0, 0, width, height)
  [buf_a, buf_b].each do |buf|
    BeginTextureMode(buf)
      ClearBackground(BLACK)
      DrawTexturePro(image_tex, src_rect, dst_rect, Vector2.create(0, 0), 0, WHITE)
    EndTextureMode()
  end

  rt_src_rect = Rectangle.create(0, 0, width, -height)

  frame_range.each_with_index do |i, idx|
    time = i.to_f / fps
    time_packed = [time].pack("f")

    export_buf = nil
    chain_idx = 0

    pass_shaders.each do |ps|
      SetShaderValue(ps[:shader], ps[:loc_time], time_packed, SHADER_UNIFORM_FLOAT)

      case ps[:role]
      when :state
        BeginTextureMode(current_buf)
          ClearBackground(BLACK)
          BeginShaderMode(ps[:shader])
            SetShaderValueTexture(ps[:shader], ps[:loc_tex1], audio_tex)
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], prev_buf[:texture]) if ps[:loc_tex2] >= 0
            DrawTexturePro(image_tex, src_rect, dst_rect, Vector2.create(0, 0), 0, WHITE)
          EndShaderMode()
        EndTextureMode()
        export_buf = current_buf

      when :display
        target = chain_idx == 0 ? chain_buf_a : chain_buf_b
        BeginTextureMode(target)
          ClearBackground(BLACK)
          BeginShaderMode(ps[:shader])
            SetShaderValueTexture(ps[:shader], ps[:loc_tex1], audio_tex)
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], current_buf[:texture]) if ps[:loc_tex2] >= 0
            DrawTexturePro(image_tex, src_rect, dst_rect, Vector2.create(0, 0), 0, WHITE)
          EndShaderMode()
        EndTextureMode()
        export_buf = target
        chain_idx = 1 - chain_idx

      when :post
        target = chain_idx == 0 ? chain_buf_a : chain_buf_b
        BeginTextureMode(target)
          ClearBackground(BLACK)
          BeginShaderMode(ps[:shader])
            SetShaderValueTexture(ps[:shader], ps[:loc_tex1], audio_tex)
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], image_tex) if ps[:loc_tex2] >= 0
            DrawTextureRec(export_buf[:texture], rt_src_rect, Vector2.create(0, 0), WHITE)
          EndShaderMode()
        EndTextureMode()
        export_buf = target
        chain_idx = 1 - chain_idx
      end
    end

    img = LoadImageFromTexture(export_buf[:texture])
    ImageFlipVertical(img)
    ExportImage(img, File.join(frame_dir, format("%05d.png", idx)))
    UnloadImage(img)

    current_buf, prev_buf = prev_buf, current_buf

    yield idx if block_given?
  end
end

# Load resources
image_tex = LoadTexture(IMAGE_PATH)
audio_tex = LoadTexture(audio_data_path)

# Ping-pong buffers (NEAREST filter prevents interpolation drift in temporal feedback)
buf_a = LoadRenderTexture(WIDTH, HEIGHT)
buf_b = LoadRenderTexture(WIDTH, HEIGHT)
SetTextureFilter(buf_a[:texture], TEXTURE_FILTER_POINT)
SetTextureFilter(buf_b[:texture], TEXTURE_FILTER_POINT)

# Load all shaders from pass list
pass_shaders = passes.map do |pass|
  source = preprocess_shader(pass[:path], SCRIPT_DIR)
  shader = LoadShaderFromMemory(nil, source)
  pass.merge(
    shader: shader,
    loc_time: GetShaderLocation(shader, "u_time"),
    loc_duration: GetShaderLocation(shader, "u_duration"),
    loc_tex1: GetShaderLocation(shader, "texture1"),
    loc_tex2: GetShaderLocation(shader, "texture2"),
  )
end
pass_shaders.each { |ps| SetShaderValue(ps[:shader], ps[:loc_duration], [duration].pack("f"), SHADER_UNIFORM_FLOAT) }

puts "    Passes: #{passes.map { |p| "#{File.basename(p[:path])}(#{p[:role]})" }.join(" → ")}"

# Chain buffers: only needed for multi-pass chains
chain_buf_a = nil
chain_buf_b = nil
if pass_shaders.length > 1
  chain_buf_a = LoadRenderTexture(WIDTH, HEIGHT)
  chain_buf_b = LoadRenderTexture(WIDTH, HEIGHT)
end

# --- Step 2a: Render preview ---
preview_path = OUTPUT_PATH.sub(/(\.\w+)$/, '_preview\1')
preview_frame_dir = Dir.mktmpdir("av-preview")
actual_preview_frames = preview_end_frame - preview_start_frame

puts "==> Step 2a: Rendering #{actual_preview_frames}-frame preview..."

last_pct = -1
render_frames(preview_start_frame...preview_end_frame, preview_frame_dir, FPS,
              pass_shaders, image_tex, audio_tex,
              buf_a, buf_b, chain_buf_a, chain_buf_b, WIDTH, HEIGHT) do |idx|
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

# --- Step 2b: Render full video ---
puts "==> Step 2b: Rendering #{total_frames} frames..."

frame_dir = Dir.mktmpdir("av-frames")
last_pct = -1
render_frames(start_frame...end_frame, frame_dir, FPS,
              pass_shaders, image_tex, audio_tex,
              buf_a, buf_b, chain_buf_a, chain_buf_b, WIDTH, HEIGHT) do |idx|
  pct = (idx * 100) / total_frames
  if pct != last_pct
    print "\r    [#{"#" * (pct / 2)}#{" " * (50 - pct / 2)}] #{pct}%"
    last_pct = pct
  end
end
puts "\r    [##################################################] 100%"

# Cleanup raylib
pass_shaders.each { |ps| UnloadShader(ps[:shader]) }
UnloadTexture(image_tex)
UnloadTexture(audio_tex)
UnloadRenderTexture(buf_a)
UnloadRenderTexture(buf_b)
if pass_shaders.length > 1
  UnloadRenderTexture(chain_buf_a)
  UnloadRenderTexture(chain_buf_b)
end
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
