# frozen_string_literal: true

require "test_helper"

class TestKliipitPipeline < Minitest::Test
  def test_that_it_has_a_version_number
    refute_nil ::KliipitPipeline::VERSION
  end

  def test_build_waveform_texture_silence
    # Silence: all zeros → should map to mid-gray (128)
    pcm = ([0] * 100).pack("s<*")
    result = KliipitPipeline.build_waveform_texture(pcm, 4, 4)
    pixels = result.unpack("C*")
    assert_equal 16, pixels.length
    pixels.each { |p| assert_in_delta 128, p, 1 }
  end

  def test_build_waveform_texture_extremes
    # Max positive → 255, max negative → 0
    pcm = [32767, -32768].pack("s<*")
    result = KliipitPipeline.build_waveform_texture(pcm, 2, 1)
    pixels = result.unpack("C*")
    assert_equal 2, pixels.length
    assert_equal 255, pixels[0]
    assert_equal 0, pixels[1]
  end

  def test_build_waveform_texture_empty
    result = KliipitPipeline.build_waveform_texture("", 4, 4)
    pixels = result.unpack("C*")
    assert_equal 16, pixels.length
    pixels.each { |p| assert_equal 128, p }
  end

  def test_find_loudest_column
    # 3x2 grayscale, column 1 is brightest
    pixels = [10, 200, 50, 20, 255, 30].pack("C*")
    col = KliipitPipeline.find_loudest_column(pixels, 3, 2)
    assert_equal 1, col
  end

  def test_find_loudest_column_empty
    col = KliipitPipeline.find_loudest_column("", 0, 0)
    assert_equal 0, col
  end

  def test_decode_audio
    require "tempfile"
    # Generate a minimal WAV file (44-byte header + PCM data)
    sample_rate = 8000
    num_samples = 8000 # 1 second
    pcm_data = (0...num_samples).map { |i| (Math.sin(2 * Math::PI * 440 * i / sample_rate) * 16000).to_i }.pack("s<*")

    wav = Tempfile.new(["test", ".wav"])
    wav.binmode
    data_size = pcm_data.bytesize
    # WAV header
    wav.write("RIFF")
    wav.write([36 + data_size].pack("V"))
    wav.write("WAVE")
    wav.write("fmt ")
    wav.write([16, 1, 1, sample_rate, sample_rate * 2, 2, 16].pack("VvvVVvv"))
    wav.write("data")
    wav.write([data_size].pack("V"))
    wav.write(pcm_data)
    wav.close

    result = KliipitPipeline.decode_audio(wav.path)
    assert_equal 4, result.length
    pcm, sr, duration, channels = result
    assert_kind_of String, pcm
    assert pcm.bytesize > 0
    assert_equal 8000, sr
    assert_in_delta 1.0, duration, 0.01
    assert_equal 1, channels
  ensure
    wav&.close!
  end

  def test_compute_spectrogram
    # Generate a simple sine wave as PCM
    sample_rate = 8000
    duration = 1.0
    samples = (sample_rate * duration).to_i
    pcm = (0...samples).map { |i| (Math.sin(2 * Math::PI * 440 * i / sample_rate) * 16000).to_i }.pack("s<*")

    result = KliipitPipeline.compute_spectrogram(pcm, sample_rate, 10, 65, 96.0)
    spec_data, width, height = result

    assert_equal 10, width   # 1 second * 10 pps
    assert_equal 65, height  # requested bins
    assert_equal width * height, spec_data.bytesize
  end
end
