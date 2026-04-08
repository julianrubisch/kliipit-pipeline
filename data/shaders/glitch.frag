#version 330

// Audio-reactive digital glitch: block displacement, color channel splits,
// pixel corruption, with time-varying row sizes and shifting rain direction.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = fragTexCoord;

    // Baseline energy floor — always some movement, even in silence
    const float BASELINE = 0.05;
    float loud = max(getLoudness(), BASELINE);
    float bass = max(getBass(), BASELINE * 0.5);
    float mids = max(getMids(), BASELINE * 0.3);
    float treble = max(getTreble(), BASELINE * 0.2);

    // Quantized time — changes every few frames for glitch stepping
    float glitchTime = floor(u_time * 12.0);

    // --- Rain direction: rotates slowly over time, jolts on bass ---
    // angle sweeps through full circle over ~20 seconds, bass kicks it
    float angle = u_time * 0.3 + bass * 3.0;
    // Quantize to 4 main directions with smooth-ish transitions
    float snapAngle = floor(angle / 1.5708) * 1.5708; // snap to 90° increments
    vec2 rainDir = vec2(cos(snapAngle), sin(snapAngle));
    // Project UV along rain direction for row calculation
    float rainCoord = dot(uv, rainDir);
    // Perpendicular axis for displacement
    vec2 shiftDir = vec2(-rainDir.y, rainDir.x);

    // --- Block size modulation: oscillates over time, jumps on transients ---
    float baseSizePhase = u_time * 0.7 + bass * 2.0;
    float baseSize = 0.01 + 0.06 * (0.5 + 0.5 * sin(baseSizePhase));
    // Add random variation per glitch step
    float blockSize = baseSize + hash(glitchTime * 0.7) * 0.04;

    // --- Row displacement along rain direction ---
    float row = floor(rainCoord / blockSize);
    float rowRand = hash(row + glitchTime);

    // More rows displace when treble is high
    float displace = step(1.0 - treble * 0.7 - loud * 0.2, rowRand);
    float shiftAmount = (hash(row * 13.0 + glitchTime) - 0.5) * 0.15 * treble;
    uv += shiftDir * shiftAmount * displace;

    // --- Large block corruption on bass transients ---
    float bigBlockSize = 0.08 + 0.06 * sin(u_time * 0.4);
    float bigBlockCoord = floor(rainCoord / bigBlockSize);
    float bigBlockRand = hash(bigBlockCoord + floor(u_time * 4.0));
    float bassGlitch = step(1.0 - bass * 0.5, bigBlockRand);
    uv += shiftDir * bassGlitch * (hash2(vec2(bigBlockCoord, glitchTime)) - 0.5) * 0.12;

    // --- Secondary micro-glitch: very thin rows, high frequency ---
    float microSize = 0.003 + treble * 0.005;
    float microRow = floor(rainCoord / microSize);
    float microRand = hash(microRow * 7.0 + glitchTime * 3.0);
    float microDisplace = step(1.0 - treble * 0.3, microRand);
    uv += shiftDir * microDisplace * (hash(microRow + glitchTime) - 0.5) * 0.02;

    // --- RGB channel split, direction follows rain ---
    float splitAmount = loud * 0.02 + treble * 0.015;
    float r = texture(texture0, uv + shiftDir * splitAmount).r;
    float g = texture(texture0, uv).g;
    float b = texture(texture0, uv - shiftDir * splitAmount).b;
    vec3 img = vec3(r, g, b);

    // --- Scanline interference on mids, perpendicular to rain ---
    float scanCoord = dot(gl_FragCoord.xy, abs(rainDir));
    float scan = 1.0 - mids * 0.2 * step(0.5, fract(scanCoord * 0.5));
    img *= scan;

    // --- Digital noise blocks on treble spikes ---
    float noiseBlockPx = 3.0 + 5.0 * hash(glitchTime * 0.3);
    vec2 noiseBlock = floor(gl_FragCoord.xy / noiseBlockPx);
    float noiseVal = hash2(noiseBlock + glitchTime);
    float noiseThreshold = 1.0 - treble * 0.1;
    if (noiseVal > noiseThreshold) {
        vec3 noiseColor = vec3(hash2(noiseBlock + glitchTime + 1.0));
        noiseColor *= vec3(0.8 + 0.4 * rainDir.x, 1.0, 0.8 - 0.4 * rainDir.x);
        img = mix(img, noiseColor, 0.25);
    }

    // --- Color quantization on bass (dithered bitcrush, Jitter fx.bitcrush technique) ---
    float levels = mix(256.0, 6.0, bass * 0.7);
    float ign = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
    img += (ign - 0.5) / levels;
    img = floor(img * levels) / levels;

    // --- Invert flash on loud transients ---
    float invertFlash = step(0.8, loud) * step(0.6, hash(glitchTime * 7.0));
    img = mix(img, 1.0 - img, invertFlash * 0.6);

    // --- CRT color cast that shifts with rain direction ---
    img.r *= 1.0 + loud * 0.1 * max(rainDir.x, 0.0);
    img.g *= 1.0 + loud * 0.08;
    img.b *= 1.0 + loud * 0.1 * max(-rainDir.x, 0.0);

    // --- Brightness boost ---
    img *= 1.0 + loud * 0.4;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
