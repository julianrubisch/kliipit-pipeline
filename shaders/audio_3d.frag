#version 330
// 3D Audio Visualizer — raymarched city of bars deformed by spectrum
// Adapted from https://www.shadertoy.com/view/Dtj3zW on Shadertoy (by kishimisu)
// License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
// https://creativecommons.org/licenses/by-nc-sa/4.0/

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

#define light(d, att) 1.0 / (1.0 + pow(abs(d * att), 1.3))

mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, s, -s, c);
}

float logX(float x, float a, float c) {
    return 1.0 / (exp(-a * (x - c)) + 1.0);
}

float logisticAmp(float amp) {
    float c = 0.88, a = 20.0;
    return (logX(amp, a, c) - logX(0.0, a, c)) / (logX(1.0, a, c) - logX(0.0, a, c));
}

float getPitch(float freq, float octave) {
    freq = pow(2.0, freq) * 261.0;
    freq = pow(2.0, octave) * freq / 12000.0;
    return logisticAmp(getFrequencyRaw(freq));
}

float getVol() {
    return getLoudness();
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec2 res = vec2(textureSize(texture0, 0));
    vec2 uv = (2.0 * vec2(fragTexCoord.x, 1.0 - fragTexCoord.y) - 1.0) * vec2(res.x / res.y, 1.0);

    vec3 col = vec3(0.1, 0.0, 0.14);
    float vol = getVol();

    vec3 ro = vec3(0.0, 8.0, 12.0) * (1.0 + vol * 0.3);
    ro.zx *= rot(u_time * 0.4);
    vec3 f = normalize(-ro);
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
    vec3 rd = normalize(f + uv.x * r + uv.y * cross(f, r));

    for (float i = 0.0, t = 0.0; i < 30.0; i++) {
        vec3 p = ro + t * rd;

        vec2 cen = floor(p.xz) + 0.5;
        vec3 id = abs(vec3(cen.x, 0.0, cen.y));
        float d = length(id);

        float freq = smoothstep(0.0, 20.0, d) * 3.0 + hash13(id) * 2.0;
        float pitch = getPitch(freq, 0.7);

        float v = vol * smoothstep(2.0, 0.0, d);
        float h = d * 0.2 * (1.0 + pitch * 1.5) + v * 2.0;
        float me = sdBox(p - vec3(cen.x, -50.0, cen.y), vec3(0.3, 50.0 + h, 0.3) + pitch) - 0.05;

        col += mix(mix(vec3(0.8, 0.2, 0.4), vec3(0.0, 1.0, 0.0), min(v * 2.0, 1.0)),
                   vec3(0.5, 0.3, 1.2), smoothstep(10.0, 30.0, d))
               * (cos(id) + 1.5)
               * (pitch * d * 0.08 + v)
               * light(me, 20.0) * (1.0 + vol * 2.0);

        t += me;
    }

    finalColor = vec4(col, 1.0);
}
