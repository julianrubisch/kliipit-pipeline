# frozen_string_literal: true

module KliipitPipeline
  module Encoder
    def self.open_pipe(output_path:, audio_path:, fps:, width:, height:, start_offset: 0.0)
      cmd = [
        "ffmpeg", "-y", "-v", "warning",
        "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", "#{width}x#{height}",
        "-r", fps.to_s,
        "-i", "-"
      ]
      cmd += ["-ss", start_offset.to_s] if start_offset > 0
      cmd += [
        "-i", audio_path,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "256k",
        "-shortest", output_path
      ]
      IO.popen(cmd, "wb")
    end
  end
end
