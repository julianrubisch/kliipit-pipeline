#version 330
// Audio Reactive Discoteq — neon animated lines with blur/glow
// Adapted from https://www.shadertoy.com/view/mlfBDX on Shadertoy (by wj)
// License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

#define S smoothstep
const float NUM_LINES = 20.0;

vec4 Line(float vu0, float t, vec2 uv, float speed, float height, vec3 col) {
    float ti = 1.0 - t;
    float vu = getFrequencyRaw(ti) * ti;

    float b = S(1.0, 0.0, abs(uv.x)) * sin(u_time * speed + uv.x * height * t) * 0.2;
    uv.y += b * 2.0 * (vu0 * 1.0 + 0.3);

    uv.x += vu * 12.0 - 2.0;

    return vec4(S(0.06 * S(0.2, 0.9, abs(uv.x)), 0.0, abs(uv.y) - 0.004) * col, 1.0)
           * S(1.0, 0.3, abs(uv.x));
}

void main() {
    vec2 res = vec2(textureSize(texture0, 0));
    vec2 uv = (fragTexCoord - 0.5) * vec2(res.x / res.y, 1.0);

    vec4 O = vec4(0.0);

    float vu0 = (getFrequencyRaw(0.1) + getFrequencyRaw(0.2) +
                 getFrequencyRaw(0.4) + getFrequencyRaw(0.6) +
                 getFrequencyRaw(0.7) + getFrequencyRaw(0.9)) / 6.0;

    for (float i = 0.0; i <= NUM_LINES; i += 1.0) {
        float t = i / NUM_LINES;
        float c = (vu0 - t) + 0.3;
        O += Line(vu0, t, uv, 1.0 + t, 4.0 + t, vec3(0.2 + c * 0.7, 0.2 + c * 0.4, 0.3)) * 2.0;
    }

    finalColor = O;
}
