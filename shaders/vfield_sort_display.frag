#version 330

// Vector field pixel sort — DISPLAY PASS
// Reads clean sort state from texture2 via texelFetch.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio data (unused)
uniform sampler2D texture2;  // current sort state
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

void main() {
    ivec2 icoord = ivec2(gl_FragCoord.xy);
    vec3 sorted = texelFetch(texture2, icoord, 0).rgb;
    finalColor = vec4(sorted, 1.0);
}
