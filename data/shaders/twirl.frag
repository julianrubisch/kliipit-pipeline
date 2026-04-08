#version 330
// Twirl — spiral vortex distortion from center
// Inspired by Jitter td.twirl. Audio-reactive amplitude and tightness.

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

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Center with subtle drift
    vec2 center = vec2(0.5) + vec2(sin(u_time * 0.2), cos(u_time * 0.15)) * 0.02;

    vec2 delta = uv - center;
    float radius = length(delta);
    float angle = atan(delta.y, delta.x);

    // Twirl amount: bass drives amplitude, attenuated by distance from center
    float twirlAmp = (0.05 + bass * 0.2 + loud * 0.1);
    float falloff = smoothstep(0.7, 0.0, radius);  // stronger near center
    angle += twirlAmp * falloff;

    // Phase animation
    angle += u_time * 0.3 * mids;

    // Convert back
    vec2 twirled = center + radius * vec2(cos(angle), sin(angle));

    // Chromatic aberration along the twirl direction
    float aberr = loud * 0.012;
    vec2 aberrDir = vec2(cos(angle + 1.5708), sin(angle + 1.5708));
    float r = texture(texture0, twirled + aberrDir * aberr).r;
    float g = texture(texture0, twirled).g;
    float b = texture(texture0, twirled - aberrDir * aberr).b;
    vec3 img = vec3(r, g, b);

    // Brightness pulse
    img *= 1.0 + loud * 0.5;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
