#version 330
// Noise Warp — damped sine waves displacing the image from multiple epicenters
// Inspired by Jitter td.sinefold. Audio drives epicenter positions and wave amplitude.

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
    vec2 res = vec2(textureSize(texture0, 0));
    float aspect = res.x / res.y;

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Three epicenters drifting with time, audio pushes them
    vec2 ep1 = vec2(0.3 + sin(u_time * 0.2) * 0.15, 0.4 + cos(u_time * 0.15) * 0.1);
    vec2 ep2 = vec2(0.7 + cos(u_time * 0.25) * 0.1, 0.6 + sin(u_time * 0.3) * 0.15);
    vec2 ep3 = vec2(0.5 + sin(u_time * 0.18 + 2.0) * 0.12, 0.3 + cos(u_time * 0.22 + 1.0) * 0.12);

    vec2 totalDisplace = vec2(0.0);

    // Sinefold from epicenter 1 — bass driven
    {
        vec2 d = (uv - ep1) * vec2(aspect, 1.0);
        float dist = length(d);
        float freq = 12.0 + bass * 8.0;
        float amp = bass * 0.04;
        float damp = 1.0 - clamp(dist * 3.0, 0.0, 1.0);
        float wave = sin(dist * freq - u_time * 2.0) * amp * damp;
        totalDisplace += normalize(d + 0.0001) * wave;
    }

    // Sinefold from epicenter 2 — mids driven
    {
        vec2 d = (uv - ep2) * vec2(aspect, 1.0);
        float dist = length(d);
        float freq = 15.0 + mids * 6.0;
        float amp = mids * 0.03;
        float damp = 1.0 - clamp(dist * 3.0, 0.0, 1.0);
        float wave = sin(dist * freq - u_time * 2.5) * amp * damp;
        totalDisplace += normalize(d + 0.0001) * wave;
    }

    // Sinefold from epicenter 3 — treble driven
    {
        vec2 d = (uv - ep3) * vec2(aspect, 1.0);
        float dist = length(d);
        float freq = 20.0 + treble * 10.0;
        float amp = treble * 0.025;
        float damp = 1.0 - clamp(dist * 4.0, 0.0, 1.0);
        float wave = sin(dist * freq - u_time * 3.0) * amp * damp;
        totalDisplace += normalize(d + 0.0001) * wave;
    }

    // Correct for aspect ratio in displacement
    totalDisplace /= vec2(aspect, 1.0);

    vec2 displaced = uv + totalDisplace;

    // Chromatic aberration along displacement direction
    float aberr = loud * 0.005;
    vec2 aberrDir = normalize(totalDisplace + 0.0001);
    float r = texture(texture0, displaced + aberrDir * aberr).r;
    float g = texture(texture0, displaced).g;
    float b = texture(texture0, displaced - aberrDir * aberr).b;
    vec3 img = vec3(r, g, b);

    img *= 0.9 + loud * 0.4;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
