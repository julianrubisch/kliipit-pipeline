#version 330

// Audio-reactive domain warping: organic fluid-like distortions
// driven by layered noise, modulated by audio frequency bands

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

// Simplex-ish noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

// Fractal Brownian Motion
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = fragTexCoord;

    float loud = getLoudness();
    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();

    // Scale UV for noise
    vec2 p = uv * 3.0;

    // Time modulated by audio
    float t = u_time * 0.3 + bass * 0.5;

    // First warp layer — slow, bass-driven
    vec2 q = vec2(
        fbm(p + vec2(0.0, 0.0) + t * 0.4),
        fbm(p + vec2(5.2, 1.3) + t * 0.3)
    );

    // Second warp layer — faster, treble-driven
    vec2 r = vec2(
        fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.6),
        fbm(p + 4.0 * q + vec2(8.3, 2.8) + t * 0.5)
    );

    // Warp intensity driven by audio
    float warpAmount = 0.02 + bass * 0.06 + loud * 0.03;
    vec2 warpedUV = uv + (r - 0.5) * warpAmount;

    // Sinefold ripple layer (Jitter td.sinefold technique) — concentric shockwave on bass
    vec2 rippleCenter = uv - 0.5;
    float rippleDist = length(rippleCenter);
    float ripplePhase = rippleDist * 25.0 - u_time * 3.0;
    float rippleDamp = 1.0 - clamp(rippleDist * 2.5, 0.0, 1.0);
    vec2 rippleOffset = normalize(rippleCenter + 0.001) * sin(ripplePhase) * bass * 0.015 * rippleDamp;
    warpedUV += rippleOffset;

    // Chromatic split on warped coordinates
    float aberr = treble * 0.01;
    vec2 dir = warpedUV - 0.5;
    float red = texture(texture0, warpedUV + dir * aberr).r;
    float grn = texture(texture0, warpedUV).g;
    float blu = texture(texture0, warpedUV - dir * aberr).b;
    vec3 img = vec3(red, grn, blu);

    // Color modulation from warp pattern
    float pattern = fbm(p + 4.0 * r);
    img *= 0.8 + 0.4 * pattern;

    // Brightness pulse
    img *= 1.0 + loud * 0.8;

    // Color shift: warp pattern drives hue
    vec3 warmColor = vec3(1.2, 0.9, 0.7);
    vec3 coolColor = vec3(0.7, 0.9, 1.3);
    vec3 tint = mix(warmColor, coolColor, pattern);
    img *= mix(vec3(1.0), tint, mids * 0.5);

    // Vignette
    float vign = 1.0 - 0.4 * pow(length(uv - 0.5) * 1.4, 2.0);
    img *= vign;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
