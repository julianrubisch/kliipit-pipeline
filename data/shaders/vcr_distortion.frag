#version 330

// Adapted from Shadertoy "VCR Distortion" (ldjGzV) by Tsoding
// Audio-reactive VHS/VCR tracking distortion, tape wobble, and noise

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = fragTexCoord;

    float loud = getLoudness();
    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();

    // --- Tape wobble: FM-modulated displacement (Jitter td.wobble technique) ---
    float wobbleAmount = 0.003 + bass * 0.015;
    // Frequency modulation: wobble frequency varies along Y axis like real tape stretch
    float fmMod = sin(uv.y * 5.0 + u_time * 0.4) * 0.4;
    float wobble = sin(uv.y * (30.0 + fmMod * 15.0) + u_time * 3.0) * wobbleAmount;
    wobble += sin(uv.y * (120.0 + fmMod * 40.0) + u_time * 7.0) * wobbleAmount * 0.3;
    // Add per-scanline jitter for damaged-tape feel
    wobble += noise(vec2(uv.y * 200.0, u_time * 8.0)) * bass * 0.004;
    uv.x += wobble;

    // --- Tracking lines: horizontal bands that jump with treble ---
    float trackingSpeed = 0.5 + treble * 3.0;
    float trackPos = fract(u_time * trackingSpeed);
    float trackDist = abs(uv.y - trackPos);
    float trackWidth = 0.02 + loud * 0.04;
    float tracking = smoothstep(trackWidth, 0.0, trackDist);
    uv.x += tracking * (0.02 + treble * 0.06);

    // --- Chromatic aberration driven by loudness ---
    float aberr = 0.002 + loud * 0.008;
    float r = texture(texture0, uv + vec2(aberr, 0.0)).r;
    float g = texture(texture0, uv).g;
    float b = texture(texture0, uv - vec2(aberr, 0.0)).b;
    vec3 img = vec3(r, g, b);

    // --- Scanline darkening ---
    float scanline = sin(fragTexCoord.y * 800.0) * 0.04;
    img -= scanline;

    // --- Static noise overlay, stronger on loud sections ---
    float n = hash(fragTexCoord * 1000.0 + u_time * 100.0);
    float noiseAmount = 0.03 + loud * 0.08;
    img = mix(img, vec3(n), noiseAmount);

    // --- Tape head switching noise at bottom ---
    float headSwitch = smoothstep(0.98, 1.0, uv.y) * bass;
    img = mix(img, vec3(hash(vec2(uv.x * 100.0 + u_time, uv.y))), headSwitch);

    // --- Color bleed / smearing on bass ---
    float smear = bass * 0.01;
    img.r = mix(img.r, texture(texture0, uv + vec2(smear, 0.0)).r, bass * 0.5);

    // --- Brightness fluctuation ---
    img *= 0.95 + 0.1 * sin(u_time * 2.0 + uv.y * 5.0) * loud;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
