#version 330
// Luma Displace — image displaces itself by its own brightness
// Inspired by Jitter td.lumadisplace. Bright pixels push UVs outward.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;   // previous frame (ping-pong feedback)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

const float FEEDBACK = 0.7;  // blend with previous frame (0=none, 1=frozen)

void main() {
    vec2 uv = fragTexCoord;

    float bass = getBass();
    float mids = getMids();
    float loud = getLoudness();

    // Sample brightness at current pixel
    vec3 orig = texture(texture0, uv).rgb;
    float luma = dot(orig, vec3(0.299, 0.587, 0.114));

    // Displacement amplitude: bass drives intensity
    float amp = 0.01 + bass * 0.08 + loud * 0.03;

    // Bias: loudness shifts the zero-point so quiet areas displace too
    float offset = -0.3 + loud * 0.2;

    // Direction rotates slowly, mids add jitter
    float angle = u_time * 0.4 + mids * 2.0;
    vec2 dir = vec2(cos(angle), sin(angle));

    // Displace UV by luminance
    vec2 displacement = dir * (luma + offset) * amp;
    vec2 displaced = uv + displacement;

    // Chromatic split along displacement direction
    float aberr = bass * 0.008;
    float r = texture(texture0, displaced + dir * aberr).r;
    float g = texture(texture0, displaced).g;
    float b = texture(texture0, displaced - dir * aberr).b;
    vec3 img = vec3(r, g, b);

    // Brightness pulse
    img *= 1.0 + loud * 0.6;

    // Blend with previous frame for temporal smoothing
    vec3 prev = texture(texture2, uv).rgb;
    img = mix(img, prev, FEEDBACK);

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
