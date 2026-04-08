# frozen_string_literal: true

module KliipitPipeline
  module ShaderLoader
    def self.preprocess(path, include_dir: KliipitPipeline.shaders_dir)
      source = File.read(path)
      source.gsub(/#include\s+"([^"]+)"/) do
        inc_path = File.join(include_dir, $1)
        abort "Include not found: #{inc_path}" unless File.exist?(inc_path)
        File.read(inc_path)
      end
    end

    def self.resolve_shader_path(path)
      return path if File.exist?(path)

      # Try relative to CWD
      cwd_path = File.expand_path(path)
      return cwd_path if File.exist?(cwd_path)

      # Try bundled shaders
      bundled = File.join(KliipitPipeline.shaders_dir, File.basename(path))
      return bundled if File.exist?(bundled)

      abort "Shader not found: #{path}"
    end
  end
end
