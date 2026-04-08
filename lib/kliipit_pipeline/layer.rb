# frozen_string_literal: true

module KliipitPipeline
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
end
