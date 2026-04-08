#version 330
// Tile Mosaic — subdivide image into tiles, each posterized differently
// Inspired by Jitter fx.tiles + cc.brcosa. Audio drives tile size and quantization.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = fragTexCoord;

    float bass = getBass();
    float mids = getMids();
    float treble = getTreble();
    float loud = getLoudness();

    // Tile count: bass = fewer big tiles, treble = many small tiles
    float tileCount = 4.0 + treble * 20.0 + loud * 8.0;
    tileCount = floor(tileCount);

    // Tile grid
    vec2 tileID = floor(uv * tileCount);
    vec2 tileUV = fract(uv * tileCount);

    // Per-tile random seed
    float tileRand = hash(tileID + floor(u_time * 2.0));
    float tileRand2 = hash(tileID * 3.7 + floor(u_time * 2.0));

    // Bass → tile size jitter (tiles expand/contract on kicks)
    vec2 jitter = (vec2(tileRand, tileRand2) - 0.5) * bass * 0.4;
    vec2 jitteredUV = (tileID + 0.5 + jitter) / tileCount;

    // Mids → tile displacement (shift from grid)
    vec2 displacement = (vec2(hash(tileID + 17.0), hash(tileID + 31.0)) - 0.5) * mids * 0.03;
    jitteredUV += displacement;

    // Treble → per-tile rotation
    float tileAngle = (tileRand - 0.5) * treble * 0.5;
    vec2 tc = tileUV - 0.5;
    float ca = cos(tileAngle), sa = sin(tileAngle);
    tc = mat2(ca, sa, -sa, ca) * tc;
    vec2 rotatedTileUV = tc + 0.5;

    // Sample from jittered tile center
    vec3 img = texture(texture0, jitteredUV).rgb;

    // Per-tile posterization: different color levels per tile
    float levels = 3.0 + tileRand * 8.0 + bass * 4.0;
    img = floor(img * levels) / levels;

    // Per-tile brightness variation
    img *= 0.7 + tileRand * 0.6;

    // Per-tile hue shift on mids
    float hueShift = (tileRand - 0.5) * mids * 0.3;
    // Simple hue rotate via channel mixing
    float cs = cos(hueShift * 6.28), sn = sin(hueShift * 6.28);
    img.rgb = vec3(
        img.r * cs - img.g * sn,
        img.r * sn + img.g * cs,
        img.b
    );

    // Tile border: thin dark line between tiles (using rotated coords)
    vec2 bUV = clamp(rotatedTileUV, 0.0, 1.0);
    float border = smoothstep(0.0, 0.03, bUV.x) * smoothstep(0.0, 0.03, bUV.y)
                 * smoothstep(0.0, 0.03, 1.0 - bUV.x) * smoothstep(0.0, 0.03, 1.0 - bUV.y);
    img *= 0.3 + border * 0.7;

    // Brightness pulse
    img *= 0.8 + loud * 0.5;

    finalColor = vec4(clamp(img, 0.0, 1.0), 1.0);
}
