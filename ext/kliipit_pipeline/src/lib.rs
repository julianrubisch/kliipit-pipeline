use magnus::{function, prelude::*, Error, RArray, RString, Ruby};
use rayon::prelude::*;
use rustfft::{num_complex::Complex, FftPlanner};
use std::f64::consts::PI;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Decode an audio file to mono f32 PCM at its native sample rate.
/// Returns (pcm_data_as_i16_le_binary, sample_rate, duration_seconds, num_channels).
fn decode_audio(path: String) -> Result<RArray, Error> {
    let file = std::fs::File::open(Path::new(&path))
        .map_err(|e| Error::new(magnus::exception::runtime_error(), format!("Cannot open {}: {}", path, e)))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(&path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| Error::new(magnus::exception::runtime_error(), format!("Probe failed: {}", e)))?;

    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or_else(|| Error::new(magnus::exception::runtime_error(), "No audio track found".to_string()))?;

    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| Error::new(magnus::exception::runtime_error(), format!("Decoder init failed: {}", e)))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.capacity();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let samples = sample_buf.samples();
        let ch = spec.channels.count();

        // Mix down to mono
        for frame in 0..sample_buf.len() / ch {
            let mut sum = 0.0f32;
            for c in 0..ch {
                sum += samples[frame * ch + c];
            }
            all_samples.push(sum / ch as f32);
        }
    }

    let duration = all_samples.len() as f64 / sample_rate as f64;

    // Convert to i16 LE binary (same format the waveform texture expects)
    let pcm_i16: Vec<u8> = all_samples
        .iter()
        .flat_map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            let val = (clamped * 32767.0) as i16;
            val.to_le_bytes().to_vec()
        })
        .collect();

    let result = RArray::new();
    result.push(RString::from_slice(&pcm_i16)).unwrap();
    result.push(sample_rate as u64).unwrap();
    result.push(duration).unwrap();
    result.push(channels as u64).unwrap();
    Ok(result)
}

/// Compute a spectrogram from mono PCM i16 LE data.
///
/// Returns grayscale pixel data (width x height, row-major) as a binary string.
/// Width = duration * pixels_per_second, Height = freq_bins.
/// Uses STFT with Hann window, magnitude in dB scaled to 0-255.
fn compute_spectrogram(
    pcm_data: RString,
    sample_rate: usize,
    pixels_per_second: usize,
    freq_bins: usize,
    dynamic_range_db: f64,
) -> RArray {
    let raw = unsafe { pcm_data.as_slice() };
    let samples: Vec<f32> = raw
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
        .collect();

    let total_samples = samples.len();
    if total_samples == 0 || pixels_per_second == 0 {
        let result = RArray::new();
        result.push(RString::from_slice(&[])).unwrap();
        result.push(0u64).unwrap();
        result.push(0u64).unwrap();
        return result;
    }

    let duration = total_samples as f64 / sample_rate as f64;
    let num_columns = (duration * pixels_per_second as f64).ceil() as usize;

    // FFT size = 2 * (freq_bins - 1) for freq_bins output bins
    let fft_size = (freq_bins - 1) * 2;
    let hop_size = sample_rate / pixels_per_second;

    // Hann window
    let window: Vec<f32> = (0..fft_size)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f64 / fft_size as f64).cos()) as f32)
        .collect();

    // Compute columns in parallel
    let columns: Vec<Vec<u8>> = (0..num_columns)
        .into_par_iter()
        .map(|col| {
            let center = col * hop_size;

            // Build windowed frame
            let mut buffer: Vec<Complex<f32>> = (0..fft_size)
                .map(|i| {
                    let idx = center as isize + i as isize - fft_size as isize / 2;
                    let sample = if idx >= 0 && (idx as usize) < total_samples {
                        samples[idx as usize]
                    } else {
                        0.0
                    };
                    Complex::new(sample * window[i], 0.0)
                })
                .collect();

            // FFT (each thread creates its own planner — cheap for repeated sizes)
            let mut planner = FftPlanner::new();
            let fft = planner.plan_fft_forward(fft_size);
            fft.process(&mut buffer);

            // Magnitude spectrum (first freq_bins bins)
            let magnitudes: Vec<f32> = buffer[..freq_bins]
                .iter()
                .map(|c| c.norm())
                .collect();

            // Convert to dB and scale to 0-255
            let max_mag = magnitudes.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            let floor = if max_mag > 0.0 {
                20.0 * max_mag.log10() - dynamic_range_db as f32
            } else {
                -dynamic_range_db as f32
            };

            magnitudes
                .iter()
                .rev() // low frequencies at bottom
                .map(|&m| {
                    let db = if m > 0.0 { 20.0 * m.log10() } else { floor };
                    let normalized = (db - floor) / dynamic_range_db as f32;
                    (normalized.clamp(0.0, 1.0) * 255.0) as u8
                })
                .collect()
        })
        .collect();

    // Scatter into row-major pixel buffer
    let height = freq_bins;
    let width = num_columns;
    let mut pixels = vec![0u8; width * height];
    for (col, col_data) in columns.iter().enumerate() {
        for (row, &byte) in col_data.iter().enumerate() {
            if row < height && col < width {
                pixels[row * width + col] = byte;
            }
        }
    }

    let result = RArray::new();
    result.push(RString::from_slice(&pixels)).unwrap();
    result.push(width as u64).unwrap();
    result.push(height as u64).unwrap();
    result
}

/// Build a waveform texture from raw PCM int16 LE data.
fn build_waveform_texture(pcm_data: RString, tex_w: usize, tex_h: usize) -> RString {
    let raw = unsafe { pcm_data.as_slice() };

    let pcm_samples: Vec<i16> = raw
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let total_samples = pcm_samples.len();

    if total_samples == 0 || tex_w == 0 || tex_h == 0 {
        return RString::from_slice(&vec![128u8; tex_w * tex_h]);
    }

    let columns: Vec<Vec<u8>> = (0..tex_w)
        .into_par_iter()
        .map(|col| {
            let t_start = (col as f64 / tex_w as f64) * total_samples as f64;
            let t_end = ((col + 1) as f64 / tex_w as f64) * total_samples as f64;
            let slice_start = t_start as usize;
            let slice_end = (t_end as usize).min(total_samples);
            let slice_len = slice_end - slice_start;

            (0..tex_h)
                .map(|row| {
                    if slice_len == 0 {
                        return 128u8;
                    }
                    let sample_idx = (slice_start
                        + (row as f64 / tex_h as f64 * slice_len as f64) as usize)
                        .min(total_samples - 1);
                    let val = pcm_samples[sample_idx] as i32;
                    ((val + 32768) * 255 / 65535).clamp(0, 255) as u8
                })
                .collect()
        })
        .collect();

    let mut pixels = vec![128u8; tex_w * tex_h];
    for (col, col_data) in columns.iter().enumerate() {
        for (row, &byte) in col_data.iter().enumerate() {
            pixels[row * tex_w + col] = byte;
        }
    }

    RString::from_slice(&pixels)
}

/// Find the column with the highest energy in a grayscale spectrogram.
fn find_loudest_column(pixel_data: RString, width: usize, height: usize) -> usize {
    let pixels = unsafe { pixel_data.as_slice() };

    if width == 0 || height == 0 || pixels.len() < width * height {
        return 0;
    }

    (0..width)
        .into_par_iter()
        .map(|col| {
            let energy: u64 = (0..height)
                .map(|row| pixels[row * width + col] as u64)
                .sum();
            (col, energy)
        })
        .max_by_key(|&(_, energy)| energy)
        .map(|(col, _)| col)
        .unwrap_or(0)
}

#[magnus::init]
fn init(ruby: &Ruby) -> Result<(), Error> {
    let module = ruby.define_module("KliipitPipeline")?;
    module.define_singleton_method("decode_audio", function!(decode_audio, 1))?;
    module.define_singleton_method("compute_spectrogram", function!(compute_spectrogram, 5))?;
    module.define_singleton_method("build_waveform_texture", function!(build_waveform_texture, 3))?;
    module.define_singleton_method("find_loudest_column", function!(find_loudest_column, 3))?;
    Ok(())
}
