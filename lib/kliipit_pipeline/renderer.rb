# frozen_string_literal: true

require "raylib"

module KliipitPipeline
  class Renderer
    include Raylib

    def initialize(width:, height:, layers:, image_path:, analyzer:, include_dir:)
      @width = width
      @height = height
      @layers = layers
      @image_path = image_path
      @analyzer = analyzer
      @include_dir = include_dir
    end

    def setup!
      load_raylib_native!
      init_window!
      load_textures!
      load_layer_shaders!
      self
    end

    def render_frames(frame_range, frame_dir, fps:)
      src_rect = Rectangle.create(0, 0, @image_tex[:width], @image_tex[:height])
      dst_rect = Rectangle.create(0, 0, @width, @height)
      rt_src_rect = Rectangle.create(0, 0, @width, -@height)
      origin = Vector2.create(0, 0)

      # Initialize ping-pong buffers with source image for :blend layers
      @layers.each do |layer|
        next unless layer.mode == :blend
        [layer.buf_a, layer.buf_b].each do |buf|
          BeginTextureMode(buf)
          ClearBackground(BLACK)
          DrawTexturePro(@image_tex, src_rect, dst_rect, origin, 0, WHITE)
          EndTextureMode()
        end
        layer.current_buf = layer.buf_a
        layer.prev_buf = layer.buf_b
      end

      render_start = frame_range.first.to_f / fps

      frame_range.each_with_index do |i, idx|
        time = i.to_f / fps
        layer_time = time - render_start
        render_len = frame_range.size.to_f / fps
        time_packed = [time].pack("f")

        BeginTextureMode(@composite_buf)
        ClearBackground(BLACK)
        EndTextureMode()

        @layers.each do |layer|
          next unless layer.active_at?(layer_time, render_len)
          mix = layer.mix_at(layer_time, render_len)
          mix_packed = [mix].pack("f")
          ps = layer.state

          SetShaderValue(ps[:shader], ps[:loc_time], time_packed, SHADER_UNIFORM_FLOAT)
          SetShaderValue(ps[:shader], ps[:loc_mix], mix_packed, SHADER_UNIFORM_FLOAT) if ps[:loc_mix] >= 0

          BeginTextureMode(layer.current_buf)
          ClearBackground(BLACK)
          BeginShaderMode(ps[:shader])
          SetShaderValueTexture(ps[:shader], ps[:loc_tex1], @audio_tex)
          SetShaderValueTexture(ps[:shader], ps[:loc_tex3], @waveform_tex) if ps[:loc_tex3] >= 0
          case layer.mode
          when :blend
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], layer.prev_buf[:texture]) if ps[:loc_tex2] >= 0
            DrawTexturePro(@image_tex, src_rect, dst_rect, origin, 0, WHITE)
          when :post
            SetShaderValueTexture(ps[:shader], ps[:loc_tex2], @image_tex) if ps[:loc_tex2] >= 0
            DrawTextureRec(@composite_buf[:texture], rt_src_rect, origin, WHITE)
          end
          EndShaderMode()
          EndTextureMode()

          output = layer.current_buf
          if layer.has_display
            dp = layer.display
            SetShaderValue(dp[:shader], dp[:loc_time], time_packed, SHADER_UNIFORM_FLOAT)
            SetShaderValue(dp[:shader], dp[:loc_mix], mix_packed, SHADER_UNIFORM_FLOAT) if dp[:loc_mix] >= 0
            BeginTextureMode(@display_buf)
            ClearBackground(BLACK)
            BeginShaderMode(dp[:shader])
            SetShaderValueTexture(dp[:shader], dp[:loc_tex1], @audio_tex)
            SetShaderValueTexture(dp[:shader], dp[:loc_tex2], layer.current_buf[:texture]) if dp[:loc_tex2] >= 0
            SetShaderValueTexture(dp[:shader], dp[:loc_tex3], @waveform_tex) if dp[:loc_tex3] >= 0
            DrawTexturePro(@image_tex, src_rect, dst_rect, origin, 0, WHITE)
            EndShaderMode()
            EndTextureMode()
            output = @display_buf
          end

          alpha = (mix * 255).round.clamp(0, 255)
          tint = Color.new
          tint[:r] = 255
          tint[:g] = 255
          tint[:b] = 255
          tint[:a] = alpha
          BeginTextureMode(@composite_buf)
          DrawTextureRec(output[:texture], rt_src_rect, origin, tint)
          EndTextureMode()

          layer.swap_buffers! if layer.mode == :blend
        end

        img = LoadImageFromTexture(@composite_buf[:texture])
        ImageFlipVertical(img)
        ExportImage(img, File.join(frame_dir, format("%05d.png", idx)))
        UnloadImage(img)

        yield idx if block_given?
      end
    end

    def cleanup!
      @layers.each do |layer|
        UnloadShader(layer.state[:shader])
        UnloadShader(layer.display[:shader]) if layer.has_display
        UnloadRenderTexture(layer.buf_a)
        UnloadRenderTexture(layer.buf_b)
      end
      UnloadTexture(@image_tex)
      UnloadTexture(@audio_tex)
      UnloadTexture(@waveform_tex)
      UnloadRenderTexture(@composite_buf)
      UnloadRenderTexture(@display_buf) if @display_buf
      CloseWindow()
    end

    private

    def load_raylib_native!
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
    end

    def init_window!
      SetConfigFlags(FLAG_WINDOW_HIDDEN)
      SetTraceLogLevel(LOG_ERROR)
      InitWindow(@width, @height, "kliipit-pipeline")
      SetTargetFPS(9999)
    end

    def load_textures!
      @image_tex = LoadTexture(@image_path)

      # Build spectrogram texture from raw pixel data
      @audio_tex = texture_from_grayscale(
        @analyzer.spectrogram_data,
        @analyzer.spectrogram_width,
        @analyzer.spectrogram_height
      )

      # Build waveform texture from PCM data
      @waveform_tex = texture_from_grayscale(
        @analyzer.build_waveform_pixel_data,
        @analyzer.waveform_tex_width,
        AudioAnalyzer::WAVEFORM_TEX_HEIGHT
      )
    end

    def texture_from_grayscale(pixel_data, width, height)
      ptr = FFI::MemoryPointer.new(:uint8, pixel_data.bytesize)
      ptr.write_bytes(pixel_data)

      image = Image.new
      image[:data] = ptr
      image[:width] = width
      image[:height] = height
      image[:mipmaps] = 1
      image[:format] = PIXELFORMAT_UNCOMPRESSED_GRAYSCALE

      LoadTextureFromImage(image)
    end

    def load_layer_shaders!
      duration = @analyzer.duration

      @layers.each do |layer|
        layer.state = load_shader_with_locs(layer.shader_path)
        SetShaderValue(layer.state[:shader], layer.state[:loc_duration], [duration].pack("f"), SHADER_UNIFORM_FLOAT)

        if layer.has_display
          layer.display = load_shader_with_locs(layer.display_path)
          SetShaderValue(layer.display[:shader], layer.display[:loc_duration], [duration].pack("f"), SHADER_UNIFORM_FLOAT)
        end

        layer.buf_a = LoadRenderTexture(@width, @height)
        layer.buf_b = LoadRenderTexture(@width, @height)
        SetTextureFilter(layer.buf_a[:texture], TEXTURE_FILTER_POINT)
        SetTextureFilter(layer.buf_b[:texture], TEXTURE_FILTER_POINT)
        layer.current_buf = layer.buf_a
        layer.prev_buf = layer.buf_b
      end

      @composite_buf = LoadRenderTexture(@width, @height)
      @display_buf = @layers.any?(&:has_display) ? LoadRenderTexture(@width, @height) : nil
    end

    def load_shader_with_locs(path)
      source = ShaderLoader.preprocess(path, include_dir: @include_dir)
      shader = LoadShaderFromMemory(nil, source)
      {
        shader: shader,
        loc_time: GetShaderLocation(shader, "u_time"),
        loc_duration: GetShaderLocation(shader, "u_duration"),
        loc_mix: GetShaderLocation(shader, "u_mix"),
        loc_tex1: GetShaderLocation(shader, "texture1"),
        loc_tex2: GetShaderLocation(shader, "texture2"),
        loc_tex3: GetShaderLocation(shader, "texture3")
      }
    end
  end
end
