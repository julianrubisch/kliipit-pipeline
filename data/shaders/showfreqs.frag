#version 330

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;        // source image (ignored — standalone generative)
uniform sampler2D texture1;        // audio data texture (X=time, Y=frequency)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

// --- Tunable constants ---
const int   NUM_BARS   = 64;       // Number of mel-spaced frequency bars
const float LOG_SCALE  = 10.0;     // Amplitude log compression factor
const float FREQ_MIN   = 20.0;     // Lowest displayed frequency (Hz)
const float FREQ_MAX   = 20000.0;  // Highest displayed frequency (Hz)
const float SAMPLE_RATE = 44100.0; // Audio sample rate
const float BAR_GAP    = 0.15;     // Fractional gap between bars (0-1)
const vec3  BAR_COLOR  = vec3(1.0);             // White bars, opacity = magnitude

// --- Mel scale conversions ---
float hzToMel(float hz) { return 2595.0 * log(1.0 + hz / 700.0) / log(10.0); }
float melToHz(float mel) { return 700.0 * (pow(10.0, mel / 2595.0) - 1.0); }

// Map frequency in Hz to spectrogram Y coordinate (normalized 0-1)
// texture1 Y=0 is highest freq, Y=1 is lowest (inverted in audio_common.glsl)
float hzToSpecY(float hz) {
    // Nyquist maps to normalized freq 1.0
    float normFreq = clamp(hz / (SAMPLE_RATE * 0.5), 0.0, 1.0);
    return 1.0 - normFreq;
}

void main() {
    vec2 uv = fragTexCoord;
    vec3 vizColor = vec3(0.0);

    float tx = clamp(u_time / u_duration, 0.0, 1.0);

    // Determine which bar this pixel falls in
    float barFloat = uv.x * float(NUM_BARS);
    int barIndex = int(floor(barFloat));
    float barFrac = fract(barFloat); // position within the bar (0-1)

    // Gap: suppress pixels in the gap region
    float barMask = smoothstep(0.0, 0.05, barFrac) * (1.0 - smoothstep(1.0 - BAR_GAP, 1.0 - BAR_GAP + 0.05, barFrac));

    if (barIndex >= 0 && barIndex < NUM_BARS) {
        // Mel-scale frequency mapping
        float melLow  = hzToMel(FREQ_MIN);
        float melHigh = hzToMel(FREQ_MAX);

        float melStart = melLow + (melHigh - melLow) * float(barIndex) / float(NUM_BARS);
        float melEnd   = melLow + (melHigh - melLow) * float(barIndex + 1) / float(NUM_BARS);

        float hzStart = melToHz(melStart);
        float hzEnd   = melToHz(melEnd);

        float specYStart = hzToSpecY(hzStart);
        float specYEnd   = hzToSpecY(hzEnd);

        // Average spectrogram bins within this mel band
        float mag = 0.0;
        const int BIN_SAMPLES = 4;
        for (int s = 0; s < BIN_SAMPLES; s++) {
            float t = float(s) / float(BIN_SAMPLES);
            float sy = mix(specYEnd, specYStart, t); // specYEnd < specYStart (inverted)
            mag += texture(texture1, vec2(tx, sy)).r;
        }
        mag /= float(BIN_SAMPLES);

        // Log amplitude scaling (matching ffmpeg ascale=log)
        float amp = log(1.0 + mag * LOG_SCALE) / log(1.0 + LOG_SCALE);

        // Bar height + opacity both driven by magnitude
        float barHeight = 1.0 - uv.y; // 0 at top, 1 at bottom
        float barLit = 1.0 - smoothstep(amp - 0.005, amp, barHeight);
        vizColor = BAR_COLOR * amp * barLit * barMask;
    }

    finalColor = vec4(vizColor, 1.0);
}
