import { useCallback, useEffect, useRef, useState } from "react";
import { isOriginAllowed } from "../utils/postMessage";
import { send } from "../utils/eventBus";

interface UseSpeechBridgeReturn {
  /** True when the parent app reports the browser supports speech recognition. */
  isSupported: boolean;
  /** True while the parent's recognition instance is actively listening to this session. */
  isListening: boolean;
  /** Latest transcript broadcast from the parent while listening. */
  transcript: string;
  /** Toggle listening on/off. */
  toggle: () => void;
}

/**
 * Iframe-side bridge to the parent app's speech recognition.
 *
 * The parent owns `react-speech-recognition` (this package can't install it)
 * and broadcasts SPEECH_SUPPORT / SPEECH_LISTENING / SPEECH_TRANSCRIPT.
 * This hook turns those into the same shape as the parent's
 * `useSpeechRecognition` so QuickEditBar can consume it directly.
 *
 * `transcript` resets when listening stops so each new dictation starts
 * clean — callers don't need to call resetTranscript explicitly.
 */
export function useSpeechBridge(): UseSpeechBridgeReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  useEffect(function listenForSpeechMessages() {
    const handleMessage = (event: MessageEvent) => {
      if (!isOriginAllowed(event)) return;
      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      switch (data.type) {
        case "SPEECH_SUPPORT":
          setIsSupported(Boolean(data.data?.supported));
          return;
        case "SPEECH_LISTENING": {
          const listening = Boolean(data.data?.listening);
          setIsListening(listening);
          if (!listening) setTranscript("");
          return;
        }
        case "SPEECH_TRANSCRIPT":
          if (typeof data.data?.transcript === "string") {
            setTranscript(data.data.transcript);
          }
          return;
      }
    };

    window.addEventListener("message", handleMessage);
    // IFRAME_READY's SPEECH_SUPPORT broadcast races this hook's mount (it
    // mounts on hover, after IFRAME_READY usually fires). Ask the parent to
    // re-broadcast so the support flag arrives on first hover.
    if (window.parent !== window) {
      send({ type: "SPEECH_QUERY_SUPPORT" });
    }
    return () => { window.removeEventListener("message", handleMessage); };
  }, []);

  const toggle = useCallback(function toggleListening() {
    if (window.parent === window) return;
    send({ type: isListening ? "SPEECH_STOP" : "SPEECH_START" });
  }, [isListening]);

  // Stop parent recognition on every unmount path. Ref so the cleanup reads
  // the latest listening state, not a stale closure.
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;
  useEffect(function stopListeningOnUnmount() {
    return () => {
      if (isListeningRef.current && window.parent !== window) {
        send({ type: "SPEECH_STOP" });
      }
    };
  }, []);

  return { isSupported, isListening, transcript, toggle };
}
