# frozen_string_literal: true

module KliipitPipeline
  class Pipeline
    def initialize(
      audio_path:, image_path:, output_path:,
      layers:, fps: 25, start: 0.0,
      width: nil, height: nil,
      max_frames: nil, max_duration: nil,
      preview: false, &progress
    )
      @audio_path = File.expand_path(audio_path)
      @image_path = File.expand_path(image_path)
      @output_path = File.expand_path(output_path)
      @layers = layers
      @fps = fps
      @start = start.to_f
      @width = width
      @height = height
      @max_frames = max_frames
      @max_duration = max_duration
      @preview = preview
      @progress = progress
    end

    def run!
      validate_inputs!
      detect_dimensions!
      analyze_audio!
      setup_renderer!

      render_preview! if @preview
      render_full!

      @renderer.cleanup!
      @analyzer.cleanup!
    end

    private

    def log(msg)
      @progress&.call(:log, msg)
    end

    def validate_inputs!
      [@audio_path, @image_path].each do |f|
        abort "File not found: #{f}" unless File.exist?(f)
      end
      @layers.each do |layer|
        abort "Shader not found: #{layer.shader_path}" unless File.exist?(layer.shader_path)
      end
      abort "ffmpeg not found in PATH" unless system("which ffmpeg > /dev/null 2>&1")
    end

    def detect_dimensions!
      return if @width && @height

      png_header = File.binread(@image_path, 24)
      abort "#{@image_path} is not a valid PNG" unless png_header[0, 4] == "\x89PNG".b
      @width ||= png_header[16, 4].unpack1("N")
      @height ||= png_header[20, 4].unpack1("N")
      log "Image: #{@width}x#{@height} (auto-detected)"
    end

    def analyze_audio!
      log "Analyzing audio..."
      @analyzer = AudioAnalyzer.new(@audio_path, fps: @fps)
      @analyzer.analyze!
      log "Audio: #{@analyzer.duration.round(2)}s, #{@analyzer.sample_rate}Hz"
      log "Spectrogram: #{@analyzer.spectrogram_width}x#{@analyzer.spectrogram_height}"
    end

    def setup_renderer!
      log "Setting up renderer..."
      @renderer = Renderer.new(
        width: @width, height: @height, layers: @layers,
        image_path: @image_path, analyzer: @analyzer,
        include_dir: KliipitPipeline.shaders_dir
      )
      @renderer.setup!
      log "Layers: #{@layers.map(&:label).join(" + ")}"
    end

    def compute_frame_range
      duration = @analyzer.duration
      total_frames = (duration * @fps).to_i

      if @max_frames
        total_frames = [total_frames, @max_frames].min
      elsif @max_duration
        total_frames = [total_frames, (@max_duration * @fps).to_i].min
      end

      total_audio_frames = (duration * @fps).to_i
      start_frame = [[@start * @fps, 0].max.to_i, total_audio_frames].min
      end_frame = [start_frame + total_frames, total_audio_frames].min

      start_frame...end_frame
    end

    def render_preview!
      loudest_time = @analyzer.find_loudest_time
      window = @analyzer.preview_window(loudest_time)
      preview_path = @output_path.sub(/(\.\w+)$/, '_preview\1')

      log "Loudest moment: #{loudest_time.round(2)}s — preview: #{window[:start].round(2)}s–#{(window[:start] + AudioAnalyzer::PREVIEW_DURATION).round(2)}s"

      frame_range = window[:start_frame]...window[:end_frame]
      total = frame_range.size

      log "Rendering #{total}-frame preview..."
      render_piped(frame_range, preview_path, start_offset: window[:start]) do |idx|
        @progress&.call(:progress, idx, total)
      end
      log "Preview: #{preview_path}"
    end

    def render_full!
      frame_range = compute_frame_range
      total = frame_range.size
      start_offset = frame_range.first.to_f / @fps

      log "Rendering #{total} frames..."
      render_piped(frame_range, @output_path, start_offset: start_offset) do |idx|
        @progress&.call(:progress, idx, total)
      end
      log "Done: #{@output_path}"
    end

    def render_piped(frame_range, output_path, start_offset: 0.0, &progress)
      pipe = Encoder.open_pipe(
        output_path: output_path, audio_path: @audio_path,
        fps: @fps, width: @width, height: @height,
        start_offset: start_offset
      )
      @renderer.render_frames(frame_range, pipe, fps: @fps, &progress)
    ensure
      pipe&.close
    end
  end
end
