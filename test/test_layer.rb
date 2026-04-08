# frozen_string_literal: true

require "test_helper"

class TestLayer < Minitest::Test
  def setup
    # Use a real shader path from bundled data
    @shader = File.join(KliipitPipeline.shaders_dir, "overdrive.frag")
  end

  def test_defaults
    layer = KliipitPipeline::Layer.new(shader: @shader)
    assert_nil layer.start
    assert_nil layer.end_time
    assert_equal 0.0, layer.fade_in
    assert_equal 0.0, layer.fade_out
    assert_equal :blend, layer.mode
  end

  def test_mix_at_no_fades
    layer = KliipitPipeline::Layer.new(shader: @shader)
    assert_equal 1.0, layer.mix_at(0.0, 10.0)
    assert_equal 1.0, layer.mix_at(5.0, 10.0)
    assert_equal 1.0, layer.mix_at(10.0, 10.0)
  end

  def test_mix_at_fade_in
    layer = KliipitPipeline::Layer.new(shader: @shader, fade_in: 2.0)
    assert_equal 0.0, layer.mix_at(0.0, 10.0)
    assert_in_delta 0.5, layer.mix_at(1.0, 10.0)
    assert_equal 1.0, layer.mix_at(2.0, 10.0)
    assert_equal 1.0, layer.mix_at(5.0, 10.0)
  end

  def test_mix_at_fade_out
    layer = KliipitPipeline::Layer.new(shader: @shader, fade_out: 2.0)
    assert_equal 1.0, layer.mix_at(5.0, 10.0)
    assert_in_delta 0.5, layer.mix_at(9.0, 10.0)
    assert_equal 0.0, layer.mix_at(10.0, 10.0)
  end

  def test_mix_at_with_start_end
    layer = KliipitPipeline::Layer.new(shader: @shader, start: 2.0, end_time: 8.0, fade_in: 1.0, fade_out: 1.0)
    assert_equal 0.0, layer.mix_at(1.0, 10.0)
    assert_in_delta 0.5, layer.mix_at(2.5, 10.0)
    assert_equal 1.0, layer.mix_at(4.0, 10.0)
    assert_in_delta 0.5, layer.mix_at(7.5, 10.0)
    assert_equal 0.0, layer.mix_at(9.0, 10.0)
  end

  def test_active_at
    layer = KliipitPipeline::Layer.new(shader: @shader, start: 2.0, end_time: 8.0)
    refute layer.active_at?(1.0, 10.0)
    assert layer.active_at?(2.0, 10.0)
    assert layer.active_at?(5.0, 10.0)
    assert layer.active_at?(8.0, 10.0)
    refute layer.active_at?(9.0, 10.0)
  end

  def test_active_at_defaults_to_full_duration
    layer = KliipitPipeline::Layer.new(shader: @shader)
    assert layer.active_at?(0.0, 10.0)
    assert layer.active_at?(10.0, 10.0)
  end

  def test_swap_buffers
    layer = KliipitPipeline::Layer.new(shader: @shader)
    layer.buf_a = :a
    layer.buf_b = :b
    layer.current_buf = :a
    layer.prev_buf = :b

    layer.swap_buffers!

    assert_equal :b, layer.current_buf
    assert_equal :a, layer.prev_buf
  end

  def test_label
    layer = KliipitPipeline::Layer.new(shader: @shader, start: 1.0, end_time: 5.0, fade_in: 0.5, mode: :post)
    label = layer.label
    assert_includes label, "overdrive.frag"
    assert_includes label, "post"
    assert_includes label, "1.0s"
    assert_includes label, "5.0s"
    assert_includes label, "fade_in=0.5"
  end
end
