#version 330
// Noise Terrain — fBm noise rendered as a pseudo-3D heightmap with lighting
// Inspired by Jitter gn.gnoise + lighting. Bass pushes peaks, audio drives color.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = fragTexCoord;
    vec2 res = vec2(textureSize(texture0, 0));

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Scale and animate the noise field — higher frequency for more detail
    float t = u_time * 0.1;
    vec2 p = uv * 8.0 + vec2(t * 0.5, t * 0.3);

    // Height: fBm with bass gently pushing peaks up (use smoothed values)
    float bassSmooth = getBass();  // already lowpass-filtered by audio_common
    float trebSmooth = getTreble();
    float h = fbm(p) * (0.6 + bassSmooth * 0.4);
    h += fbm(p * 2.0 + vec2(5.2, 1.3) + t) * trebSmooth * 0.15;

    // Normal from central differences (for lighting)
    float eps = 1.0 / res.x * 4.0;
    float heightScale = 0.6 + bassSmooth * 0.4;
    float hx = fbm((uv + vec2(eps, 0.0)) * 8.0 + vec2(t * 0.5, t * 0.3)) * heightScale;
    float hy = fbm((uv + vec2(0.0, eps)) * 8.0 + vec2(t * 0.5, t * 0.3)) * heightScale;
    vec3 normal = normalize(vec3((h - hx) / eps, (h - hy) / eps, 1.0));

    // Lighting — broad, soft
    vec3 lightDir = normalize(vec3(-0.4, -0.3, 1.0));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float wrap = max(dot(normal, lightDir) * 0.5 + 0.5, 0.0); // wrap lighting for softer shadows

    // Specular — broad highlight
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 8.0);

    // Color: height mapped directly to a bright palette
    // Remap h from its typical 0.3-0.7 range to full 0-1
    float hNorm = smoothstep(0.2, 0.8, h);

    vec3 col;
    vec3 c1 = vec3(0.15, 0.3, 0.6);    // blue low
    vec3 c2 = vec3(0.2, 0.65, 0.35);   // green
    vec3 c3 = vec3(0.85, 0.75, 0.25);  // gold
    vec3 c4 = vec3(1.0, 0.95, 0.85);   // bright peak

    if (hNorm < 0.33) {
        col = mix(c1, c2, hNorm / 0.33);
    } else if (hNorm < 0.66) {
        col = mix(c2, c3, (hNorm - 0.33) / 0.33);
    } else {
        col = mix(c3, c4, (hNorm - 0.66) / 0.34);
    }

    // Apply wrap lighting + specular
    col = col * (0.4 + wrap * 0.6) + vec3(1.0, 0.95, 0.85) * spec * 0.5;

    // Audio brightness
    col *= 0.9 + loud * 0.6;

    finalColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
