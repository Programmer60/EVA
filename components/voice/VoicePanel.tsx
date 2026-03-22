"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type TtsMode = "browser" | "server";

function noopSubscribe(): () => void {
  return () => undefined;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeCtor = (
    window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    }
  ).SpeechRecognition
    ?? (
      window as Window & {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    ).webkitSpeechRecognition;

  return maybeCtor ?? null;
}

export function VoicePanel() {
  const MAX_NETWORK_RETRIES = 1;
  const serverSttEnabled = process.env.NEXT_PUBLIC_ENABLE_SERVER_STT === "true";
  const serverTtsEnabled = process.env.NEXT_PUBLIC_ENABLE_SERVER_TTS === "true";
  const [isListening, setIsListening] = useState(false);
  const [isServerRecording, setIsServerRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [ttsMode, setTtsMode] = useState<TtsMode>("browser");
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [lastReply, setLastReply] = useState<string>("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isRetryingNetwork, setIsRetryingNetwork] = useState(false);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptBufferRef = useRef("");
  const transcriptPreviewRef = useRef("");
  const transcriptSubmittedRef = useRef(false);
  const retryingNetworkRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsRequestIdRef = useRef(0);

  const speechRecognitionSupported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getSpeechRecognitionCtor()),
    () => false,
  );
  const speechSynthesisSupported = useSyncExternalStore(
    noopSubscribe,
    () =>
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined" &&
      typeof window.SpeechSynthesisUtterance !== "undefined",
    () => false,
  );
  const mediaRecorderSupported = useSyncExternalStore(
    noopSubscribe,
    () => typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined",
    () => false,
  );

  const canPlayReply =
    Boolean(lastReply) && (ttsMode === "browser" ? speechSynthesisSupported : serverTtsEnabled);

  const stopSpeaking = useCallback((): void => {
    ttsRequestIdRef.current += 1;

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
      audioElementRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(false);
  }, []);

  const speakTextWithBrowser = useCallback((text: string): void => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) {
      return;
    }

    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      setVoiceError("Could not play voice reply.");
    };

    window.speechSynthesis.speak(utterance);
  }, [stopSpeaking]);

  const speakTextWithServer = useCallback(async (text: string): Promise<void> => {
    const clean = text.trim();
    if (!clean) {
      return;
    }

    if (!serverTtsEnabled) {
      setVoiceError("Server TTS fallback is disabled. Use Browser TTS mode.");
      return;
    }

    stopSpeaking();
    const requestId = ttsRequestIdRef.current + 1;
    ttsRequestIdRef.current = requestId;
    setVoiceError(null);
    setIsSpeaking(true);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voiceId: "alloy" }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({ error: "Server TTS failed." }))) as { error?: string };
        throw new Error(data.error || "Server TTS failed.");
      }

      const audioBlob = await response.blob();
      if (requestId !== ttsRequestIdRef.current) {
        return;
      }

      const objectUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = objectUrl;

      const audio = new Audio(objectUrl);
      audioElementRef.current = audio;

      audio.onended = () => {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        if (audioElementRef.current === audio) {
          audioElementRef.current = null;
        }
        setIsSpeaking(false);
      };

      audio.onerror = () => {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        if (audioElementRef.current === audio) {
          audioElementRef.current = null;
        }
        setVoiceError("Could not play server voice reply.");
        setIsSpeaking(false);
      };

      await audio.play();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server TTS failed.";
      setVoiceError(message);
      setIsSpeaking(false);
    }
  }, [serverTtsEnabled, stopSpeaking]);

  const speakText = useCallback((text: string): void => {
    if (!text.trim()) {
      return;
    }

    if (ttsMode === "server") {
      void speakTextWithServer(text);
      return;
    }

    speakTextWithBrowser(text);
  }, [speakTextWithBrowser, speakTextWithServer, ttsMode]);

  function sendTranscriptDraftToChat(message: string): void {
    if (typeof window === "undefined" || !message.trim()) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("eva:voice-draft", {
        detail: { message: message.trim() },
      }),
    );
  }

  function stopListening(): void {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function flushTranscriptToChat(): void {
    const finalText = transcriptBufferRef.current.replace(/\s+/g, " ").trim();
    const previewText = transcriptPreviewRef.current.replace(/\s+/g, " ").trim();
    const transcript = previewText.length > finalText.length ? previewText : finalText;
    if (!transcript || transcriptSubmittedRef.current) {
      return;
    }

    transcriptSubmittedRef.current = true;
    setLastTranscript(transcript);
    sendTranscriptDraftToChat(transcript);
  }

  const stopServerRecorderTracks = useCallback((): void => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  function mapSpeechError(errorCode?: string): string {
    if (!errorCode) {
      return "Mic capture failed. Please try again.";
    }

    if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
      return "Microphone access is blocked. Allow mic permission for this site, then try Start Mic again.";
    }

    if (errorCode === "audio-capture") {
      return "No microphone was detected. Check your audio input device and try again.";
    }

    if (errorCode === "network") {
      return "Speech recognition network issue. If you are using Brave, disable Shields for localhost and retry Start Mic.";
    }

    return `Mic capture failed (${errorCode}).`;
  }

  async function ensureMicrophonePermission(): Promise<boolean> {
    if (typeof window === "undefined") {
      return false;
    }

    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (!window.isSecureContext && !isLocalhost) {
      setVoiceError("Microphone requires a secure context (HTTPS or localhost).");
      setMicPermission("denied");
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("This browser does not support microphone access APIs.");
      setMicPermission("denied");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission("granted");
      return true;
    } catch {
      setMicPermission("denied");
      setVoiceError("Microphone permission was denied. Enable mic access in browser site settings.");
      return false;
    }
  }

  async function startListening(): Promise<void> {
    await startListeningWithRetry(0);
  }

  async function startListeningWithRetry(retryAttempt: number): Promise<void> {
    setVoiceError(null);
    setIsRetryingNetwork(false);
    retryingNetworkRef.current = false;
    transcriptBufferRef.current = "";
    transcriptPreviewRef.current = "";
    transcriptSubmittedRef.current = false;

    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      setVoiceError("Speech recognition is not supported in this browser.");
      return;
    }

    const hasPermission = await ensureMicrophonePermission();
    if (!hasPermission) {
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript?.trim() ?? "";
        if (!text) continue;

        if (result.isFinal) {
          transcriptBufferRef.current = `${transcriptBufferRef.current} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }

      const preview = `${transcriptBufferRef.current} ${interimTranscript}`.replace(/\s+/g, " ").trim();
      if (preview) {
        transcriptPreviewRef.current = preview;
        setLastTranscript(preview);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "network" && retryAttempt < MAX_NETWORK_RETRIES) {
        retryingNetworkRef.current = true;
        setIsRetryingNetwork(true);
        setVoiceError("Speech recognition network issue detected. Retrying...");
        setIsListening(false);
        window.setTimeout(() => {
          void startListeningWithRetry(retryAttempt + 1);
        }, 600);
        return;
      }

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMicPermission("denied");
      }
      retryingNetworkRef.current = false;
      setIsRetryingNetwork(false);
      setVoiceError(mapSpeechError(event.error));
      setIsListening(false);
    };

    recognition.onend = () => {
      if (!retryingNetworkRef.current) {
        flushTranscriptToChat();
      }
      retryingNetworkRef.current = false;
      setIsRetryingNetwork(false);
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
      setVoiceError(null);
      setIsRetryingNetwork(false);
      retryingNetworkRef.current = false;
    } catch {
      setIsListening(false);
      retryingNetworkRef.current = false;
      setVoiceError("Could not start microphone. Check permission and try again.");
    }
  }

  function typeInstead(): void {
    if (typeof window === "undefined") {
      return;
    }

    const typed = window.prompt("Type your message to fill chat input (you can edit before Send):", "");
    const value = typed?.trim();
    if (!value) {
      return;
    }

    setLastTranscript(value);
    sendTranscriptDraftToChat(value);
  }

  async function transcribeRecordedAudio(blob: Blob): Promise<void> {
    if (!serverSttEnabled) {
      throw new Error("Server STT fallback is disabled. Use Start Mic or Type Instead.");
    }

    const extension = blob.type.includes("webm") ? "webm" : "wav";
    const file = new File([blob], `voice-input.${extension}`, { type: blob.type || "audio/webm" });
    const formData = new FormData();
    formData.append("audio", file);

    const response = await fetch("/api/stt", {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as { text?: string; error?: string };
    if (!response.ok || !data.text) {
      if (response.status === 429) {
        throw new Error("Server STT quota exceeded. Continue with free Start Mic or Type Instead.");
      }
      throw new Error(data.error || "Server STT failed.");
    }

    const transcript = data.text.trim();
    if (!transcript) {
      throw new Error("Server STT returned empty text.");
    }

    setLastTranscript(transcript);
    sendTranscriptDraftToChat(transcript);
  }

  async function startServerRecording(): Promise<void> {
    setVoiceError(null);

    if (!serverSttEnabled) {
      setVoiceError("Server STT fallback is disabled (free mode). Use Start Mic or Type Instead.");
      return;
    }

    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setVoiceError("This browser does not support server recording fallback.");
      return;
    }

    const hasPermission = await ensureMicrophonePermission();
    if (!hasPermission) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setVoiceError("Recording failed. Please try again.");
        setIsServerRecording(false);
        stopServerRecorderTracks();
      };

      recorder.onstop = async () => {
        setIsServerRecording(false);
        stopServerRecorderTracks();

        try {
          const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size <= 0) {
            setVoiceError("No audio captured. Try speaking a bit longer.");
            return;
          }
          await transcribeRecordedAudio(blob);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Server STT failed.";
          setVoiceError(msg);
        }
      };

      recorder.start();
      setIsServerRecording(true);
    } catch {
      setVoiceError("Could not start fallback recording.");
      setIsServerRecording(false);
      stopServerRecorderTracks();
    }
  }

  const stopServerRecording = useCallback((): void => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setIsServerRecording(false);
      stopServerRecorderTracks();
      return;
    }

    if (recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    setIsServerRecording(false);
    stopServerRecorderTracks();
  }, [stopServerRecorderTracks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function onAssistantReply(event: Event): void {
      const custom = event as CustomEvent<{ reply?: string }>;
      const reply = custom.detail?.reply?.trim() ?? "";
      if (!reply) {
        return;
      }

      setLastReply(reply);
      if (autoSpeak) {
        speakText(reply);
      }
    }

    window.addEventListener("eva:assistant-reply", onAssistantReply as EventListener);
    return () => {
      window.removeEventListener("eva:assistant-reply", onAssistantReply as EventListener);
      recognitionRef.current?.stop();
      stopServerRecording();
      stopSpeaking();
    };
  }, [autoSpeak, speakText, stopSpeaking, stopServerRecording]);

  return (
    <section className="eva-card">
      <div className="eva-section-header">
        <h2>Voice</h2>
        <span className="eva-pill">STT + TTS v1</span>
      </div>

      <div className="eva-row" style={{ marginTop: "0.8rem", justifyContent: "flex-start" }}>
        <label className="eva-chat-label" style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <input
            type="radio"
            name="eva-tts-mode"
            value="browser"
            checked={ttsMode === "browser"}
            onChange={() => setTtsMode("browser")}
          />
          Browser TTS
        </label>
        <label className="eva-chat-label" style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <input
            type="radio"
            name="eva-tts-mode"
            value="server"
            checked={ttsMode === "server"}
            onChange={() => setTtsMode("server")}
            disabled={!serverTtsEnabled}
          />
          Server TTS Fallback
        </label>
      </div>

      <div className="eva-voice-actions">
        {!isListening ? (
          <button
            className="eva-btn"
            type="button"
            onClick={startListening}
            disabled={!speechRecognitionSupported}
          >
            Start Mic
          </button>
        ) : (
          <button className="eva-btn" type="button" onClick={stopListening}>
            Stop Mic
          </button>
        )}

        <button
          className="eva-btn eva-btn-secondary"
          type="button"
          onClick={() => speakText(lastReply)}
          disabled={!canPlayReply}
        >
          Play Voice Reply
        </button>

        <button
          className="eva-btn eva-btn-secondary"
          type="button"
          onClick={stopSpeaking}
          disabled={!isSpeaking}
        >
          Stop Voice
        </button>

        {serverSttEnabled && (
          !isServerRecording ? (
            <button
              className="eva-btn eva-btn-secondary"
              type="button"
              onClick={startServerRecording}
              disabled={!mediaRecorderSupported}
            >
              Record Fallback
            </button>
          ) : (
            <button
              className="eva-btn eva-btn-secondary"
              type="button"
              onClick={stopServerRecording}
            >
              Stop Fallback
            </button>
          )
        )}

        <button
          className="eva-btn eva-btn-secondary"
          type="button"
          onClick={typeInstead}
        >
          Type Instead
        </button>
      </div>

      <div className="eva-row" style={{ marginTop: "0.8rem", justifyContent: "flex-start" }}>
        <label className="eva-chat-label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(event) => setAutoSpeak(event.target.checked)}
          />
          Auto-play EVA replies
        </label>
      </div>

      {lastTranscript && <p className="eva-note">Last transcript: {lastTranscript}</p>}
      {lastReply && <p className="eva-note">Last reply ready for TTS.</p>}
      {isListening && <p className="eva-note">Listening... speak naturally, then click Stop Mic to fill editable chat text.</p>}
      {isServerRecording && <p className="eva-note">Recording audio... click Stop Fallback to transcribe and send.</p>}

      {!serverSttEnabled && (
        <p className="eva-note">Free mode: using browser STT only. Server fallback is disabled.</p>
      )}

      {!serverTtsEnabled && (
        <p className="eva-note">Free mode: Browser TTS is active. Enable server TTS fallback via NEXT_PUBLIC_ENABLE_SERVER_TTS=true.</p>
      )}

      {serverTtsEnabled && ttsMode === "server" && (
        <p className="eva-note">Server TTS fallback is enabled for reply playback.</p>
      )}

      {!speechRecognitionSupported && (
        <p className="eva-note">This browser does not support Web Speech recognition.</p>
      )}

      {micPermission === "denied" && (
        <p className="eva-note">Mic is blocked. Open your browser site settings and allow microphone access.</p>
      )}

      {!speechSynthesisSupported && (
        <p className="eva-note">This browser does not support Speech Synthesis.</p>
      )}

      {voiceError && <p className="eva-error">{voiceError}</p>}
      {isRetryingNetwork && <p className="eva-note">Trying mic again automatically...</p>}
    </section>
  );
}
