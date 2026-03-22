// audio_common.glsl — Standardized audio-reactive helpers (raylib GLSL 330)
// Expects: texture1 = spectrogram data texture (X=time, Y=frequency)
//          u_time = current playback time in seconds
//          u_duration = total duration in seconds

// Smoothing window in seconds for lowpass filtering.
// At 30fps this averages ~4 frames. Adjust to taste.
const float SMOOTH_WINDOW = 0.133;
const int SMOOTH_SAMPLES = 4;

// Get raw FFT magnitude at normalized frequency for a specific time
float getFrequencyAt(float freq, float time) {
    float tx = clamp(time / u_duration, 0.0, 1.0);
    float ty = 1.0 - clamp(freq, 0.0, 1.0);
    return texture(texture1, vec2(tx, ty)).r;
}

// Get FFT magnitude at normalized frequency, lowpass filtered over time.
// Samples current + recent past frames with exponential decay weighting.
float getFrequency(float freq) {
    float sum = 0.0;
    float weightSum = 0.0;
    float dt = SMOOTH_WINDOW / float(SMOOTH_SAMPLES);

    for (int i = 0; i < SMOOTH_SAMPLES; i++) {
        float t = u_time - float(i) * dt;
        // Exponential decay: recent frames weighted more heavily
        float w = exp(-2.0 * float(i) / float(SMOOTH_SAMPLES));
        sum += getFrequencyAt(freq, t) * w;
        weightSum += w;
    }
    return sum / weightSum;
}

// Raw (unsmoothed) frequency access for shaders that need instant response
float getFrequencyRaw(float freq) {
    return getFrequencyAt(freq, u_time);
}

// Overall loudness — average across 32 bins, lowpass filtered
float getLoudness() {
    float sum = 0.0;
    for (int i = 0; i < 32; i++) {
        sum += getFrequency(float(i) / 32.0);
    }
    return sum / 32.0;
}

// Bass energy — bottom ~3% of spectrum (roughly 0–660 Hz)
float getBass() {
    float sum = 0.0;
    for (int i = 0; i < 4; i++) {
        sum += getFrequency(float(i) / 128.0);
    }
    return sum / 4.0;
}

// Mid energy — ~3–19% of spectrum (roughly 660 Hz–4 kHz)
float getMids() {
    float sum = 0.0;
    for (int i = 4; i < 24; i++) {
        sum += getFrequency(float(i) / 128.0);
    }
    return sum / 20.0;
}

// Treble energy — ~19–50% of spectrum (4 kHz+)
float getTreble() {
    float sum = 0.0;
    for (int i = 24; i < 64; i++) {
        sum += getFrequency(float(i) / 128.0);
    }
    return sum / 40.0;
}
