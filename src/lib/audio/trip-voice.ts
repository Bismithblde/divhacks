export type TripVoiceRequest =
  | { kind: "route-started" }
  | {
      kind: "transit-check-in";
      mode: "BUS" | "SUBWAY";
      routeName?: string;
    };

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl = "";

export function stopTripVoice() {
  activeAudio?.pause();
  activeAudio = null;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = "";
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export async function playTripVoice(
  request: TripVoiceRequest,
  fallbackText: string,
  signal?: AbortSignal,
) {
  stopTripVoice();
  try {
    const response = await fetch("/api/audio/transit-check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error("Voice provider unavailable");
    const blob = await response.blob();
    if (signal?.aborted) return;
    activeObjectUrl = URL.createObjectURL(blob);
    activeAudio = new Audio(activeObjectUrl);
    await activeAudio.play();
  } catch {
    if (signal?.aborted || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(fallbackText);
    utterance.rate = 1.02;
    window.speechSynthesis.speak(utterance);
  }
}
