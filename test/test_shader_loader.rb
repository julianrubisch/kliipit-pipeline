# frozen_string_literal: true

require "test_helper"
require "tempfile"

class TestShaderLoader < Minitest::Test
  def test_preprocess_resolves_include
    Dir.mktmpdir do |dir|
      # Write a fake include file
      File.write(File.join(dir, "common.glsl"), "// common code\n")

      # Write a shader that includes it
      shader = Tempfile.new(["test", ".frag"], dir)
      shader.write(%(#version 330\n#include "common.glsl"\nvoid main() {}\n))
      shader.close

      result = KliipitPipeline::ShaderLoader.preprocess(shader.path, include_dir: dir)
      assert_includes result, "// common code"
      refute_includes result, '#include'
    end
  end

  def test_preprocess_with_bundled_audio_common
    shader_path = File.join(KliipitPipeline.shaders_dir, "overdrive.frag")
    result = KliipitPipeline::ShaderLoader.preprocess(shader_path)
    # audio_common.glsl should be inlined
    assert_includes result, "getBass"
    assert_includes result, "getMids"
    refute_includes result, '#include'
  end

  def test_resolve_shader_path_absolute
    path = File.join(KliipitPipeline.shaders_dir, "overdrive.frag")
    assert_equal path, KliipitPipeline::ShaderLoader.resolve_shader_path(path)
  end

  def test_resolve_shader_path_bundled_basename
    resolved = KliipitPipeline::ShaderLoader.resolve_shader_path("overdrive.frag")
    assert_equal File.join(KliipitPipeline.shaders_dir, "overdrive.frag"), resolved
  end
end
