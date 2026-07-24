"use client";

let audioContext: AudioContext | null = null;
let ringtoneTimer: number | null = null;

function context() {
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

export function initializeNotificationSounds() {
  const unlock = () => {
    try {
      context();
    } catch {
      // Audio support is optional; the visual notification remains available.
    }
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

function tone(
  frequency: number,
  startsIn: number,
  duration: number,
  volume: number,
) {
  const audio = context();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime + startsIn;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

export function playMessageNotification() {
  try {
    tone(880, 0, 0.12, 0.08);
    tone(1175, 0.1, 0.16, 0.065);
  } catch {
    // Browsers may block sound until the first user interaction.
  }
}

export function startIncomingRingtone() {
  stopIncomingRingtone();
  const ring = () => {
    try {
      tone(659, 0, 0.34, 0.09);
      tone(784, 0.36, 0.34, 0.09);
      tone(988, 0.72, 0.42, 0.075);
    } catch {
      // The next interval can succeed after the user interacts with the page.
    }
  };
  ring();
  ringtoneTimer = window.setInterval(ring, 2_400);
  return stopIncomingRingtone;
}

export function stopIncomingRingtone() {
  if (ringtoneTimer !== null) {
    window.clearInterval(ringtoneTimer);
    ringtoneTimer = null;
  }
}
