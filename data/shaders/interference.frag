#version 330
// Interference — multiple sine wave sources creating moiré patterns
// Inspired by Jitter gn.gloop + gn.spirals. Audio moves sources and drives frequency.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

const float PI = 3.14159265359;

void main() {
    vec2 uv = fragTexCoord;
    vec2 res = vec2(textureSize(texture0, 0));
    float aspect = res.x / res.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Wave sources: positions drift with time and audio
    vec2 src1 = vec2(sin(u_time * 0.3) * 0.2, cos(u_time * 0.2) * 0.15);
    vec2 src2 = vec2(cos(u_time * 0.25 + 1.0) * 0.25, sin(u_time * 0.35 + 2.0) * 0.2);
    vec2 src3 = vec2(sin(u_time * 0.15 + 3.0) * 0.15, cos(u_time * 0.4 + 1.5) * 0.25);

    // Audio pushes sources apart
    src1 *= 1.0 + bass * 0.5;
    src2 *= 1.0 + mids * 0.4;
    src3 *= 1.0 + treble * 0.6;

    // Wave frequency: base + audio modulation
    float freq = 25.0 + loud * 15.0;

    // Concentric waves from each source
    float w1 = sin(length(p - src1) * freq - u_time * 2.0);
    float w2 = sin(length(p - src2) * freq * 1.1 - u_time * 2.3);
    float w3 = sin(length(p - src3) * freq * 0.9 - u_time * 1.8);

    // Interference: combine waves
    float combined = (w1 + w2 + w3) / 3.0;

    // Sharp contour lines from the interference pattern
    float contour = 1.0 - smoothstep(0.0, 0.08, abs(combined));

    // Monochrome contour lines with subtle warm/cool tint
    float warm = 0.5 + 0.5 * w1;
    float cool = 0.5 + 0.5 * w2;
    vec3 col = contour * mix(vec3(0.9, 0.85, 0.7), vec3(0.7, 0.85, 0.95), cool * 0.3);

    // Background: very subtle glow
    col += vec3(0.5 + 0.5 * combined) * 0.04;

    col *= 0.6 + loud * 0.8;

    finalColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
