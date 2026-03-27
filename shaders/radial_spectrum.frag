#version 330
// Radial Audio Spectrum — circular frequency bar ring
// Adapted from https://www.shadertoy.com/view/4stfR8 on Shadertoy

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

#define M_PI 3.14159265359

const float NUM_BARS = 96.0;
const float RADIUS = 0.4;
const float INNER = 0.8;           // empty fraction of radius
const vec3 BAR_COLOR = vec3(1.0);  // white on black

vec2 rotate(vec2 point, vec2 center, float angle) {
    float s = sin(radians(angle));
    float c = cos(radians(angle));
    point -= center;
    vec2 r = vec2(point.x * c - point.y * s, point.x * s + point.y * c);
    return r + center;
}

bool inRect(vec4 region, vec2 uv) {
    return uv.x > (region.x - region.z) && uv.x < (region.x + region.z) &&
           uv.y > (region.y - region.w) && uv.y < (region.y + region.w);
}

void main() {
    vec2 res = vec2(textureSize(texture0, 0));
    float aspect = res.x / res.y;
    vec2 uv = fragTexCoord;
    uv.x *= aspect;

    vec2 center = vec2(aspect / 2.0, 0.5);
    float inside = INNER * RADIUS;
    float outside = RADIUS - inside;
    float circle = 2.0 * M_PI * inside;
    float barWidth = circle / (NUM_BARS * 2.0);

    vec3 col = vec3(0.0);

    for (int i = 1; float(i) <= NUM_BARS; i++) {
        float freq = float(i) / NUM_BARS;
        float mag = getFrequencyRaw(freq);
        float len = outside * mag + outside / 10.0;

        vec2 ruv = rotate(uv, center, 360.0 / NUM_BARS * float(i));
        vec2 pos = vec2(center.x, center.y + inside);
        vec4 region = vec4(pos.x, pos.y + len / 2.0, barWidth / 2.0, len / 2.0);

        if (inRect(region, ruv)) {
            col = BAR_COLOR;
        }
    }

    finalColor = vec4(col, 1.0);
}
