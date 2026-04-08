#version 330
// Gloop Plasma — layered sine/cosine interference patterns
// Inspired by Jitter gn.gloop. Audio-reactive frequency, phase, and threshold.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

void main() {
    vec2 uv = fragTexCoord;

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Scale UV centered
    vec2 p = (uv - 0.5) * 2.0;

    // Frequencies: use smoothed (getFrequency) not raw, and keep ranges tighter
    float f1 = 3.0 + bass * 1.5;
    float f2 = 2.5 + mids * 1.0;
    float f3 = 3.5 + treble * 1.5;
    float f4 = 2.0 + loud * 0.8;

    // Phase animation — slow
    float phase = u_time * 0.25;

    // Layered sine/cosine interference (Jitter gloop technique)
    float v = sin(p.x * f1 + phase) * cos(p.y * f2 + phase * 0.7);
    v *= sin(p.y * f3 + phase * 1.3 + sin(p.x * f4));
    v += cos(length(p) * f2 - phase * 0.5) * sin(p.x * f1 + p.y * f3 + phase);
    v = v * 0.5 + 0.5;

    // Threshold with fade for clean contour lines
    float thresh = 0.4 + bass * 0.15;
    float fade = 0.05 + treble * 0.1;
    float mask = smoothstep(thresh - fade, thresh, abs(v));

    // Color: cycle hue over time, bass shifts palette
    float hue = v * 2.0 + u_time * 0.1 + bass;
    vec3 col;
    col.r = 0.5 + 0.5 * sin(hue * 6.28 + 0.0);
    col.g = 0.5 + 0.5 * sin(hue * 6.28 + 2.09);
    col.b = 0.5 + 0.5 * sin(hue * 6.28 + 4.18);

    col *= mask * (0.6 + loud * 1.0);

    finalColor = vec4(col, 1.0);
}
