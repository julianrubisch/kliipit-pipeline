#version 330

// Pixel sort — DISPLAY PASS
// Reads clean sort state from texture2, applies visual effects.
// These do NOT feed back into the sort.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio data
uniform sampler2D texture2;  // current sort state
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

float luminance(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = fragTexCoord;

    float freq = uv.x;
    float energy = (
        getFrequency(freq - 0.02) +
        getFrequency(freq - 0.01) +
        getFrequency(freq) +
        getFrequency(freq + 0.01) +
        getFrequency(freq + 0.02)
    ) / 5.0;

    float loud = getLoudness();
    float bass = getBass();
    float treble = getTreble();

    // Read sort state and original
    vec3 sorted = texture(texture2, uv).rgb;
    vec3 original = texture(texture0, uv).rgb;

    vec3 result = sorted;

    // --- Highlight sort displacement with glow ---
    float displacement = length(sorted - original);
    // Warm/cool edge glow where pixels have been displaced (no green bias)
    float warmth = 1.0 - freq; // 0=cool(right), 1=warm(left)
    vec3 glowColor = mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.7, 0.5), warmth);
    result += displacement * energy * 1.2 * glowColor;

    // --- Chromatic aberration on active columns ---
    float aberr = energy * 0.008;
    if (aberr > 0.001) {
        result.r = mix(result.r, texture(texture2, uv + vec2(aberr, 0.0)).r, 0.6);
        result.b = mix(result.b, texture(texture2, uv - vec2(aberr, 0.0)).b, 0.6);
    }

    // --- Brightness boost to make dark images more visible ---
    result *= 1.0 + loud * 0.6 + energy * 0.4;

    // --- Column dividers pulse with energy ---
    float colEdge = abs(fract(uv.x * 64.0) - 0.5) * 2.0;
    float colLine = smoothstep(0.92, 1.0, colEdge) * energy * 0.2;
    result += colLine;

    // --- Vignette ---
    float vign = 1.0 - 0.3 * pow(length(uv - 0.5) * 1.4, 2.0);
    result *= vign;

    finalColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
