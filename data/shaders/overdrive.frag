#version 330

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;        // source image
uniform sampler2D texture1;        // audio data texture
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

// Distortion: displace UV based on bass
vec2 bassDistort(vec2 uv, float bass) {
    float angle = bass * 6.2831 + u_time * 0.5;
    vec2 offset = vec2(cos(angle), sin(angle)) * bass * 0.04;
    return uv + offset;
}

void main() {
    vec2 uv = fragTexCoord;

    float loud = getLoudness();
    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();

    // --- Zoom pulse on bass — dramatic ---
    float zoom = 1.0 - bass * 0.12;
    vec2 zuv = 0.5 + (uv - 0.5) * zoom;

    // --- Bass-driven UV distortion ---
    zuv = bassDistort(zuv, bass);

    // --- Heavy chromatic aberration on treble ---
    float aberr = treble * 0.025 + loud * 0.008;
    vec2 dir = zuv - 0.5;
    float r = texture(texture0, zuv + dir * aberr).r;
    float g = texture(texture0, zuv).g;
    float b = texture(texture0, zuv - dir * aberr).b;
    vec3 img = vec3(r, g, b);

    // --- Brightness surge on loudness ---
    img *= 1.0 + loud * 1.5;

    // --- Bloom / glow: radial blur from center (Jitter cf.radialblur technique) ---
    vec2 toCenter = (vec2(0.5) - zuv) * loud * 0.08;
    vec3 bloom = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        bloom += texture(texture0, zuv + toCenter * float(i)).rgb;
    }
    bloom /= 8.0;
    img += max(bloom - img, vec3(0.0)) * loud * 0.6;

    // --- Color temperature shift: magenta on bass, cyan on treble ---
    img.r *= 1.0 + bass * 0.5;
    img.g *= 1.0 - bass * 0.15 + treble * 0.1;
    img.b *= 1.0 + treble * 0.5;

    // --- Scan lines that throb with mids ---
    float scanFreq = 200.0 + mids * 300.0;
    float scan = 0.85 + 0.15 * sin(gl_FragCoord.y * 3.14159 * 2.0 / scanFreq + u_time * 4.0);
    scan = mix(1.0, scan, mids * 0.8);
    img *= scan;

    // --- Horizontal glitch slices on treble transients ---
    float glitchChance = step(0.6, treble) * treble;
    float row = floor(gl_FragCoord.y / 8.0);
    float glitchOffset = glitchChance * sin(row * 123.456 + u_time * 37.0) * 0.03;
    vec3 glitchSample = texture(texture0, zuv + vec2(glitchOffset, 0.0)).rgb;
    img = mix(img, glitchSample * (1.0 + loud), glitchChance * 0.5);

    // --- Invert flash on loud transients ---
    float invertMix = smoothstep(0.7, 0.9, loud) * 0.3;
    img = mix(img, 1.0 - img, invertMix);

    // --- Vignette that breathes ---
    float vignStrength = 0.5 - loud * 0.3;
    float vign = 1.0 - vignStrength * pow(length(uv - 0.5) * 1.4, 2.0);
    img *= vign;

    // --- Film grain ---
    float grain = fract(sin(dot(gl_FragCoord.xy + u_time * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
    img += (grain - 0.5) * 0.06 * loud;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
