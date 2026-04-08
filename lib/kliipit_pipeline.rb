# frozen_string_literal: true

require_relative "kliipit_pipeline/version"
require_relative "kliipit_pipeline/kliipit_pipeline"
require_relative "kliipit_pipeline/layer"
require_relative "kliipit_pipeline/shader_loader"
require_relative "kliipit_pipeline/audio_analyzer"
require_relative "kliipit_pipeline/renderer"
require_relative "kliipit_pipeline/encoder"
require_relative "kliipit_pipeline/pipeline"
require_relative "kliipit_pipeline/cli"

module KliipitPipeline
  class Error < StandardError; end

  def self.root
    File.expand_path("..", __dir__)
  end

  def self.data_dir
    File.join(root, "data")
  end

  def self.shaders_dir
    File.join(data_dir, "shaders")
  end

  def self.samples_dir
    File.join(root, "samples")
  end

  def self.compositions_dir
    File.join(samples_dir, "compositions")
  end
end
