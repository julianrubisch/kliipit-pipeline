# frozen_string_literal: true

module KliipitPipeline
  class AudioAnalyzer
    MAX_TEXTURE_WIDTH = 16384
    WAVEFORM_TEX_HEIGHT = 1024
    PREVIEW_DURATION = 2.0
    SPECTROGRAM_BINS = 129
    DYNAMIC_RANGE_DB = 96.0

    attr_reader :duration, :sample_rate, :spectrogram_pps,
                :waveform_tex_width, :pcm_data,
                :spectrogram_data, :spectrogram_width, :spectrogram_height

    def initialize(audio_path, fps:)
      @audio_path = audio_path
      @fps = fps
    end

    def analyze!
      result = KliipitPipeline.decode_audio(@audio_path)
      @pcm_data = result[0]
      @sample_rate = result[1]
      @duration = result[2]

      @spectrogram_pps = @fps
      spectrogram_width = (@duration * @spectrogram_pps).ceil
      if spectrogram_width > MAX_TEXTURE_WIDTH
        @spectrogram_pps = (MAX_TEXTURE_WIDTH / @duration).floor
      end

      @waveform_tex_width = [(@duration * @spectrogram_pps).ceil, MAX_TEXTURE_WIDTH].min

      spec_result = KliipitPipeline.compute_spectrogram(
        @pcm_data, @sample_rate, @spectrogram_pps,
        SPECTROGRAM_BINS, DYNAMIC_RANGE_DB
      )
      @spectrogram_data = spec_result[0]
      @spectrogram_width = spec_result[1]
      @spectrogram_height = spec_result[2]

      self
    end

    def build_waveform_pixel_data
      KliipitPipeline.build_waveform_texture(@pcm_data, @waveform_tex_width, WAVEFORM_TEX_HEIGHT)
    end

    def find_loudest_time
      col = KliipitPipeline.find_loudest_column(@spectrogram_data, @spectrogram_width, @spectrogram_height)
      col.to_f / @spectrogram_pps
    end

    def preview_window(loudest_time)
      preview_start = [loudest_time - PREVIEW_DURATION / 2.0, 0.0].max
      preview_start = [preview_start, @duration - PREVIEW_DURATION].min if @duration > PREVIEW_DURATION
      preview_frames = (PREVIEW_DURATION * @fps).to_i
      total_audio_frames = (@duration * @fps).to_i
      preview_start_frame = (preview_start * @fps).to_i
      preview_end_frame = [preview_start_frame + preview_frames, total_audio_frames].min

      {
        start: preview_start,
        start_frame: preview_start_frame,
        end_frame: preview_end_frame
      }
    end

    def cleanup!
      # No tempfiles to clean up anymore — all data is in memory
    end
  end
end
