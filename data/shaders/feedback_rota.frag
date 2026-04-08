#version 330
// Feedback Rota — rotation + zoom + temporal feedback spiral
// Inspired by Jitter jit.fx.rota. Classic video feedback look.
// Image spirals inward/outward over time, audio drives zoom and rotation.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;   // previous frame (ping-pong feedback)
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

    // Read previous frame with slight rotation + zoom
    vec2 center = vec2(0.5);
    vec2 p = uv - center;

    // Bass → rotation direction and speed
    float angle = 0.005 + bass * 0.015;
    // Mids → wobble the rotation (oscillate direction)
    angle *= 1.0 - mids * 0.5 * sin(u_time * 2.0);
    float ca = cos(angle), sa = sin(angle);
    p = mat2(ca, sa, -sa, ca) * p;

    // Bass → zoom (outward push on kicks)
    float zoom = 0.998 - bass * 0.004;
    // Treble → slight zoom jitter
    zoom -= treble * 0.001 * sin(u_time * 7.0);
    p *= zoom;

    // Mids → shift the feedback center (drifting spiral origin)
    vec2 drift = vec2(sin(u_time * 0.3), cos(u_time * 0.4)) * mids * 0.005;
    vec2 feedbackUV = p + center + drift;
    vec3 prev = texture(texture2, feedbackUV).rgb;

    // Treble → faster decay (bright treble = less trail persistence)
    prev *= 0.97 - treble * 0.03;

    // Loud → how much original image bleeds through (higher = sharper)
    vec3 orig = texture(texture0, uv).rgb;
    float blendAmt = 0.25 + loud * 0.15;

    vec3 img = mix(prev, orig, blendAmt);

    // Bass → warm color shift, treble → cool color shift per iteration
    img.r = img.r * (1.0 + bass * 0.04) - treble * 0.01;
    img.b = img.b * (1.0 + treble * 0.04) - bass * 0.01;
    // Subtle channel rotation for prismatic effect
    img.rgb = img.gbr * 0.015 + img.rgb * 0.985;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
