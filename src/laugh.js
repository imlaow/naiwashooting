// Naiwa's laugh sound, played with his laugh animation after every 5th kill.

const audio = new Audio(`${import.meta.env.BASE_URL}assets/laugh.m4a`);
audio.preload = 'auto';
let active = false;

audio.addEventListener('ended', () => { active = false; });

export const laugh = {
  play(muted) {
    active = true;
    audio.currentTime = 0;
    audio.muted = muted;
    audio.play().catch(() => {});
  },
  // Playback position in seconds, or null when the sound isn't running (blocked or ended).
  // The animation follows it so the frames stay in sync with the audio.
  time() { return active && !audio.paused ? audio.currentTime : null; },
  setMuted(muted) { audio.muted = muted; },
  pause() { if (active) audio.pause(); },
  resume() { if (active) audio.play().catch(() => {}); },
  stop() { active = false; audio.pause(); },
};
