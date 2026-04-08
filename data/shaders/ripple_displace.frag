#version 330
// Ripple Displace — concentric wave displacement of the image
// Inspired by Jitter td.ripples. Bass drives amplitude, expanding from center.

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
    vec2 res = vec2(textureSize(texture0, 0));
    float aspect = res.x / res.y;

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Center with subtle drift
    vec2 center = vec2(0.5) + vec2(sin(u_time * 0.2), cos(u_time * 0.15)) * mids * 0.03;

    vec2 delta = (uv - center) * vec2(aspect, 1.0);
    float radius = length(delta);

    // Wave parameters
    float waveFreq = 15.0 + treble * 10.0;
    float waveSpeed = u_time * 3.0;
    float waveAmp = bass * 0.04 + loud * 0.015;

    // Concentric ripple: displacement along radial direction
    float wave = sin(radius * waveFreq - waveSpeed);
    // Dampen with distance (stronger near center)
    wave *= smoothstep(0.6, 0.0, radius);

    vec2 displacement = normalize(delta + 0.0001) * wave * waveAmp;
    vec2 displaced = uv + displacement;

    // Second harmonic for richness
    float wave2 = sin(radius * waveFreq * 1.7 - waveSpeed * 1.3) * 0.4;
    wave2 *= smoothstep(0.4, 0.0, radius);
    displaced += normalize(delta + 0.0001) * wave2 * waveAmp * 0.5;

    // Chromatic split along radial direction
    float aberr = loud * 0.006;
    vec2 radDir = normalize(delta + 0.0001);
    float r = texture(texture0, displaced + radDir * aberr / vec2(aspect, 1.0)).r;
    float g = texture(texture0, displaced).g;
    float b = texture(texture0, displaced - radDir * aberr / vec2(aspect, 1.0)).b;
    vec3 img = vec3(r, g, b);

    img *= 0.9 + loud * 0.4;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
