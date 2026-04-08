#version 330
// Cartopol — Cartesian-to-polar coordinate remap (tunnel/wormhole)
// Inspired by Jitter td.cartopol. Audio drives scale and zoom speed.

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

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Center and aspect-correct
    vec2 res = vec2(textureSize(texture0, 0));
    vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);

    // Polar conversion
    float radius = length(p);
    float theta = atan(p.y, p.x) + PI;

    // Map polar to texture coordinates:
    // theta -> X (wraps around), radius -> Y (zooms in forever)
    float tunnelX = theta / (2.0 * PI);
    float tunnelY = 1.0 / (radius + 0.001);  // infinite zoom toward center

    // Audio-driven zoom speed and rotation — gentle
    tunnelY += u_time * (0.05 + bass * 0.08);
    tunnelX += u_time * 0.01 + mids * 0.02;

    // Scale modulation
    float scale = 1.0 + treble * 0.1;
    vec2 tunnelUV = vec2(tunnelX * scale, fract(tunnelY * 0.3));

    // Sample with subtle chromatic aberration
    float aberr = loud * 0.004;
    float r = texture(texture0, tunnelUV + vec2(aberr, 0.0)).r;
    float g = texture(texture0, tunnelUV).g;
    float b = texture(texture0, tunnelUV - vec2(aberr, 0.0)).b;
    vec3 img = vec3(r, g, b);

    // Depth fog: darken toward center and edges
    float fog = smoothstep(0.0, 0.15, radius) * smoothstep(0.8, 0.3, radius);
    img *= fog;

    // Brightness pulse
    img *= 0.8 + loud * 0.7;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
