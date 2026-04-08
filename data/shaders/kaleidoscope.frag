#version 330
// Kaleidoscope — angular folding into symmetric segments
// Inspired by Jitter td.kaleido. Audio-reactive division count and rotation.

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

    // Origin shifts subtly with treble
    vec2 origin = vec2(0.5) + vec2(sin(u_time * 0.3), cos(u_time * 0.4)) * treble * 0.05;

    // Division count: bass drives more segments (4 to 12)
    float divisions = floor(4.0 + bass * 8.0);
    divisions = max(divisions, 3.0);

    // Rotation offset driven by mids
    float rotOffset = u_time * 0.2 + mids * 1.5;

    // Convert to polar
    vec2 dt = uv - origin;
    float radius = length(dt);
    float theta = atan(dt.y, dt.x) + PI + rotOffset;

    // Fold angle into divisions
    float phi = 2.0 * PI / divisions;
    float foldTheta = phi - abs(mod(abs(theta), phi * 2.0) - phi);

    // Convert back to Cartesian
    vec2 foldedUV = origin + radius * vec2(cos(foldTheta), sin(foldTheta));

    // Chromatic aberration at fold edges
    float aberr = loud * 0.015;
    vec2 aberrDir = normalize(dt + 0.001);
    float r = texture(texture0, foldedUV + aberrDir * aberr).r;
    float g = texture(texture0, foldedUV).g;
    float b = texture(texture0, foldedUV - aberrDir * aberr).b;
    vec3 img = vec3(r, g, b);

    // Brightness pulse
    img *= 1.0 + loud * 0.5;

    // Vignette
    float vign = 1.0 - 0.4 * pow(length(uv - 0.5) * 1.4, 2.0);
    img *= vign;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
