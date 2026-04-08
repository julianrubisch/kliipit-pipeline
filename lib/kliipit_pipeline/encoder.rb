# frozen_string_literal: true

module KliipitPipeline
  module Encoder
    def self.mux(frame_dir:, output_path:, audio_path:, fps:, start_offset: 0.0)
      cmd = [
        "ffmpeg", "-y", "-v", "warning",
        "-framerate", fps.to_s,
        "-start_number", "0",
        "-i", File.join(frame_dir, "%05d.png")
      ]
      cmd += ["-ss", start_offset.to_s] if start_offset > 0
      cmd += [
        "-i", audio_path,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "256k",
        "-shortest", output_path
      ]
      system(*cmd, exception: true)
    end
  end
end
