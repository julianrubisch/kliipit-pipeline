#version 330

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;        // source image (unused — standalone generative)
uniform sampler2D texture1;        // audio data texture (spectrogram)
uniform sampler2D texture3;        // waveform PCM data (X=time, Y=sample position)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

const vec3 WAVE_COLOR = vec3(1.0);

void main() {
    vec2 uv = fragTexCoord;

    float tx = clamp(u_time / u_duration, 0.0, 1.0);

    // Sample PCM value: uv.x maps to sample position within current time slice
    float pcm = texture(texture3, vec2(tx, uv.x)).r;
    float amplitude = (pcm - 0.5) * 2.0;  // map [0,1] back to [-1,1]

    // Vertical bar from center to amplitude (ffmpeg showwaves mode=line style)
    float waveY = 0.5 - amplitude * 0.45;
    float top = min(0.5, waveY);
    float bot = max(0.5, waveY);

    // Anti-alias edges
    float pxH = abs(dFdy(fragTexCoord.y));
    if (pxH < 1e-6) pxH = 1.0 / 512.0;

    float inside = smoothstep(top - pxH, top, uv.y) * (1.0 - smoothstep(bot, bot + pxH, uv.y));

    vec3 vizColor = WAVE_COLOR * inside;

    finalColor = vec4(vizColor, 1.0);
}
