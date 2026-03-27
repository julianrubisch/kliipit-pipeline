#version 330
// Morphblob — slowly morphing dark shape with pseudo-3D lighting
// against a pink/magenta gradient. Audio subtly influences the shape.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

// --- Noise ---
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2(i);
    float b = hash2(i + vec2(1.0, 0.0));
    float c = hash2(i + vec2(0.0, 1.0));
    float d = hash2(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
        v += a * valueNoise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 res = vec2(textureSize(texture0, 0));
    float aspect = res.x / res.y;
    vec2 uv = fragTexCoord;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

    float bass = getBass();
    float loud = getLoudness();

    // --- Morphing shape boundary via fBm ---
    float angle = atan(p.y, p.x);
    float dist = length(p);

    // Polar noise: shape boundary varies with angle and time
    float t = u_time * 0.15;
    float boundary = 0.12 + 0.18 * fbm(vec2(angle * 1.2 + t, t * 0.7))
                          + 0.12 * fbm(vec2(angle * 2.7 - t * 1.3, t * 0.5 + 3.0))
                          + 0.07 * fbm(vec2(angle * 5.0 + t * 2.1, dist * 4.0 - t))
                          + 0.04 * valueNoise(vec2(angle * 8.0 - t * 3.0, dist * 6.0))
                          + bass * 0.06;

    // Signed distance from boundary (negative = inside)
    float sd = dist - boundary;

    // --- Background gradient ---
    float gt = 1.0 - abs(uv.y - 0.5) * 2.0;
    gt = smoothstep(0.0, 1.0, gt);
    vec3 bg = mix(vec3(0.05, 0.0, 0.08), vec3(0.85, 0.45, 0.75), gt);
    bg *= 0.7 + loud * 0.5;

    // --- Shape with pseudo-3D lighting ---
    if (sd < 0.0) {
        // Inside the blob
        float interior = clamp(-sd / 0.15, 0.0, 1.0); // depth: 0 at edge, 1 deep inside

        // Fake normal from fBm gradient (central differences)
        float eps = 0.005;
        float bx = fbm(vec2((angle + eps) * 1.5 + t, t * 0.7))
                  - fbm(vec2((angle - eps) * 1.5 + t, t * 0.7));
        float by = fbm(vec2(angle * 1.5 + t, (t + eps) * 0.7))
                  - fbm(vec2(angle * 1.5 + t, (t - eps) * 0.7));
        vec2 n2d = normalize(vec2(bx, by) + 0.001);

        // Light from upper-left
        vec3 lightDir = normalize(vec3(-0.4, -0.5, -1.0));
        vec3 normal = normalize(vec3(n2d * 0.6, -1.0));
        float diffuse = max(dot(normal, -lightDir), 0.0);

        // Specular highlight
        vec3 viewDir = vec3(0.0, 0.0, -1.0);
        vec3 halfDir = normalize(-lightDir - viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), 30.0);

        // Audio-reactive lighting: orbiting light + surface flashes
        float mids = getMids();
        float treble = getTreble();

        // Orbiting audio light — broad diffuse glow tracking loudness
        vec3 audioLight = normalize(vec3(
            sin(u_time * 0.7) * 0.6,
            cos(u_time * 0.5) * 0.5,
            -1.0
        ));
        float audioDiffuse = max(dot(normal, -audioLight), 0.0);
        vec3 audioHalf = normalize(-audioLight - viewDir);
        float audioSpec = pow(max(dot(normal, audioHalf), 0.0), 16.0);
        vec3 orbitLight = vec3(0.4, 0.2, 0.5) * audioDiffuse * bass * 0.3
                        + vec3(0.9, 0.7, 1.0) * audioSpec * loud * 0.4;

        // Surface flashes: bright spots that pop in on loud moments
        float flash1 = valueNoise(vec2(angle * 2.0 + u_time * 1.5, dist * 8.0));
        float flash2 = valueNoise(vec2(angle * 3.5 - u_time * 2.0, dist * 5.0 + 7.0));
        float flash3 = valueNoise(vec2(angle * 5.0 + u_time * 0.8, dist * 12.0 - 3.0));
        float flashMask = smoothstep(0.7 - loud * 0.25, 0.85, flash1)
                        + smoothstep(0.75 - bass * 0.2, 0.9, flash2) * 0.7
                        + smoothstep(0.8 - treble * 0.15, 0.92, flash3) * 0.5;
        vec3 flashes = vec3(0.9, 0.75, 1.0) * flashMask * loud * 1.2;

        vec3 audioReflection = orbitLight + flashes;

        // Dark body with subtle purple shading + highlight
        vec3 col = vec3(0.02, 0.01, 0.04) * (0.3 + diffuse * 0.7);
        col += vec3(0.7, 0.6, 0.9) * spec * 0.3;
        col += audioReflection;

        // Rim light at edge (background color bleeds in, pulses with audio)
        float rim = smoothstep(0.0, 0.03 + loud * 0.01, -sd);
        col = mix(bg * (0.4 + loud * 0.3), col, rim);

        finalColor = vec4(col, 1.0);
    } else {
        // Soft edge glow
        float glow = exp(-sd * 40.0) * 0.15;
        finalColor = vec4(bg + glow * vec3(0.5, 0.2, 0.5), 1.0);
    }
}
