#version 330

// Vector field pixel sort — DISPLAY PASS
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
    vec2 res = vec2(textureSize(texture2, 0));
    vec2 pixelSize = 1.0 / res;

    float bass   = getBass();
    float mids   = getMids();
    float treble = getTreble();
    float loud   = getLoudness();

    // Read sort state and original
    vec3 sorted   = texture(texture2, uv).rgb;
    vec3 original = texture(texture0, uv).rgb;

    vec3 result = sorted;

    // --- Displacement glow ---
    // Where pixels moved far from original, add warm/cool glow (no green bias)
    float displacement = length(sorted - original);
    vec3 glowColor = mix(
        vec3(1.0, 0.75, 0.5),   // warm (bass-driven)
        vec3(0.5, 0.7, 1.0),    // cool (treble-driven)
        treble / (bass + treble + 0.001)
    );
    result += displacement * 1.5 * glowColor * (0.5 + loud);

    // --- Chromatic aberration along sort displacement ---
    float aberr = displacement * 0.006 + loud * 0.003;
    if (aberr > 0.001) {
        result.r = mix(result.r, texture(texture2, uv + vec2(aberr, 0.0)).r, 0.5);
        result.b = mix(result.b, texture(texture2, uv - vec2(aberr, 0.0)).b, 0.5);
    }

    // --- Brightness boost ---
    result *= 1.0 + loud * 0.5 + bass * 0.3;

    // --- Color temperature: warm on bass, cool on treble ---
    result.r *= 1.0 + bass * 0.25;
    result.b *= 1.0 + treble * 0.25;

    // --- Scan lines that pulse with mids ---
    float scanFreq = 300.0 + mids * 200.0;
    float scan = 0.9 + 0.1 * sin(gl_FragCoord.y * 3.14159 * 2.0 / scanFreq + u_time * 3.0);
    scan = mix(1.0, scan, mids * 0.6);
    result *= scan;

    // --- Edge highlight where sort boundaries are visible ---
    vec3 left  = texture(texture2, uv - vec2(pixelSize.x, 0.0)).rgb;
    vec3 right = texture(texture2, uv + vec2(pixelSize.x, 0.0)).rgb;
    vec3 up    = texture(texture2, uv + vec2(0.0, pixelSize.y)).rgb;
    vec3 down  = texture(texture2, uv - vec2(0.0, pixelSize.y)).rgb;
    float edge = length(right - left) + length(up - down);
    result += edge * 0.15 * loud;

    // --- Vignette ---
    float vign = 1.0 - 0.35 * pow(length(uv - 0.5) * 1.4, 2.0);
    result *= vign;

    // --- Film grain ---
    float grain = fract(sin(dot(gl_FragCoord.xy + u_time * 100.0,
                                vec2(12.9898, 78.233))) * 43758.5453);
    result += (grain - 0.5) * 0.04 * loud;

    finalColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
