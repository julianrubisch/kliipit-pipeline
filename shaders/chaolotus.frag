#version 330
// Chaolotus Sound Reactive — chaotic mandala with symmetric shapes
// Adapted from https://www.shadertoy.com/view/wstXW2 on Shadertoy

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

void main() {
    float bassFreq = pow(getBass(), 0.85);
    float medFreq = pow(getMids(), 0.85);
    float topFreq = pow(getTreble(), 0.95);

    vec2 uv = fragTexCoord;
    vec2 q = uv - vec2(0.5, 0.5);
    vec2 a = uv + mod(0.5, 0.5);
    vec3 col = vec3(0.26, 0.15, 0.43);

    float r = 0.02 + 0.9 * cos(sin(atan(q.y, q.x)) * u_time * 0.5 * sin(bassFreq / 6.3));
    float d = 0.09 * 3.0 * cos(atan(a.y, a.x) * u_time * fract(a.x *= medFreq * 0.4));

    col *= mix(r, r * 0.00009, length(q / d * 3.23 * sin(atan(cos(topFreq * 11.3)))));
    finalColor = vec4(col, 1.0);
}
