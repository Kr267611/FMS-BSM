import { useEffect, useRef, useState } from "react";

// Speaking instead of typing: the browser's own speech recognition (Chrome, Edge, Safari; not Firefox).
// The words only go into the box – nothing is sent until the person presses Send.
const recognition = (): any => (typeof window === "undefined" ? undefined : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
export const voiceSupported = (): boolean => Boolean(recognition());

// on a computer the switch is in the site settings (lock icon by the address); on a phone, in the browser or phone settings
const BLOCKED = "The microphone is blocked. Allow it for this site in the browser's site settings (on a phone: the browser or phone settings), then try again.";
// Chrome on Android repeats the earlier words in every new result when it listens continuously,
// so there it listens to one sentence at a time (press the mic again to add more)
const ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

const PROBLEM: Record<string, string> = {
  "not-allowed": BLOCKED,
  "service-not-allowed": BLOCKED,
  "no-speech": "Nothing was heard. Press the mic and speak again.",
  "audio-capture": "No microphone was found on this device.",
  network: "Voice typing needs the internet. Check the connection and try again.",
  "language-not-supported": "This browser cannot type that language – switch between HI and EN.",
};

export function useVoice(onWords: (spoken: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const live = useRef<any>(null); // the recognition that may still write into the box
  const write = useRef(onWords);
  useEffect(() => {
    write.current = onWords;
  });

  function start(lang: string) {
    const Recognition = recognition();
    if (!Recognition || live.current) return;
    setError("");
    const r = new Recognition();
    r.lang = lang;
    r.continuous = !ANDROID;
    r.interimResults = true;
    // every result so far, final and in progress, so the box always shows the whole sentence
    r.onresult = (e: any) => {
      if (live.current !== r) return;
      const spoken = Array.from(e.results as ArrayLike<any>, (x) => String(x[0]?.transcript || "").trim()).filter(Boolean).join(" ");
      write.current(spoken);
    };
    r.onerror = (e: any) => {
      if (live.current === r && e.error !== "aborted") setError(PROBLEM[e.error] || "Voice typing stopped. Try again, or type the question.");
    };
    r.onend = () => {
      if (live.current !== r) return;
      live.current = null;
      setListening(false);
    };
    live.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      live.current = null;
      setError("Voice typing could not start. Try again, or type the question.");
    }
  }

  // stop listening; the last words still arrive
  const stop = () => live.current?.stop();

  // stop and drop anything still on its way (the question is being sent), with any old voice message
  function cancel() {
    const r = live.current;
    live.current = null;
    setListening(false);
    setError("");
    r?.abort();
  }

  useEffect(
    () => () => {
      const r = live.current;
      live.current = null;
      r?.abort();
    },
    []
  );

  return { listening, error, start, stop, cancel, clearError: () => setError("") };
}
