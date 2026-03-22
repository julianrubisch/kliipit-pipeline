#version 330

// Pixel sort — STATE PASS (writes to ping-pong buffer)
// Pure structural sort: no color/brightness changes.
// Companion pixel_sort_display.frag handles aesthetics.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio data
uniform sampler2D texture2;  // previous frame (sort state)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

float luminance(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = fragTexCoord;
    vec2 pixelSize = vec2(1.0) / vec2(textureSize(texture2, 0));

    // Map column to frequency band
    float freq = uv.x;
    float energy = (
        getFrequency(freq - 0.02) +
        getFrequency(freq - 0.01) +
        getFrequency(freq) +
        getFrequency(freq + 0.01) +
        getFrequency(freq + 0.02)
    ) / 5.0;

    // Boost energy response — make it trigger more easily
    float sortIntensity = smoothstep(0.02, 0.2, energy);

    // Read previous sort state
    vec3 prev = texture(texture2, uv).rgb;
    vec3 original = texture(texture0, uv).rgb;

    // Decay toward original — stronger when quiet
    float decayRate = mix(0.1, 0.001, smoothstep(0.01, 0.15, energy));
    vec3 state = mix(prev, original, decayRate);
    float stateLum = luminance(state);

    // Compare/swap with large gaps for visible displacement
    if (sortIntensity > 0.05) {
        // Larger gaps = more dramatic displacement on dark images
        float gaps[6] = float[](1.0, 4.0, 10.0, 24.0, 48.0, 80.0);

        for (int s = 0; s < 6; s++) {
            float gap = gaps[s] * pixelSize.y;
            // Stronger swaps, especially at larger gaps
            float swapStr = sortIntensity * 0.5 / (1.0 + float(s) * 0.2);

            // Pull brighter pixel down from above
            vec2 aboveUV = uv + vec2(0.0, gap);
            if (aboveUV.y <= 1.0) {
                vec3 above = texture(texture2, aboveUV).rgb;
                float aboveLum = luminance(above);
                // Very low threshold so even slight brightness differences sort
                if (aboveLum > stateLum + 0.005) {
                    state = mix(state, above, swapStr);
                    stateLum = luminance(state);
                }
            }

            // Push current down if brighter than below
            vec2 belowUV = uv - vec2(0.0, gap);
            if (belowUV.y >= 0.0) {
                vec3 below = texture(texture2, belowUV).rgb;
                float belowLum = luminance(below);
                if (stateLum > belowLum + 0.005) {
                    state = mix(state, below, swapStr * 0.4);
                    stateLum = luminance(state);
                }
            }
        }
    }

    // Output raw state — no color manipulation
    finalColor = vec4(state, 1.0);
}
