"use client";

import {
  Activity,
  AudioLines,
  BarChart3,
  Brain,
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  CloudRain,
  Download,
  Eye,
  Gauge,
  HeartPulse,
  Info,
  Leaf,
  LockKeyhole,
  MessageSquareText,
  Mic,
  MicOff,
  Moon,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trees,
  Video,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type EnvironmentKey = "forest" | "ocean" | "rain";
type AnalysisStatus = "idle" | "loading" | "calibrating" | "running" | "error";
type Point = { x: number; y: number; z?: number };
type Blendshape = { categoryName: string; score: number };
type DetectionResult = {
  faceBlendshapes?: Array<{ categories: Blendshape[] }>;
  faceLandmarks?: Point[][];
};
type FaceLandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => DetectionResult;
  close: () => void;
};
type SpeechResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const environments = {
  forest: {
    label: "Moonlit Forest",
    short: "Forest",
    description: "Soft wind with distant birds",
    icon: Trees,
    breathing: "Inhale for 4 · hold for 2 · exhale for 6",
  },
  ocean: {
    label: "Slow Ocean",
    short: "Ocean",
    description: "Measured waves and a low sea breeze",
    icon: Waves,
    breathing: "Lengthen your exhale with the rhythm of the waves",
  },
  rain: {
    label: "Window Rain",
    short: "Rain",
    description: "Gentle rain with deep ambient noise",
    icon: CloudRain,
    breathing: "Release your shoulders and breathe without forcing it",
  },
} satisfies Record<EnvironmentKey, { label: string; short: string; description: string; icon: typeof Trees; breathing: string }>;

const initialHistory = [31, 32, 30, 34, 35, 33, 36, 38, 37, 40, 39, 41, 42, 39, 41, 40, 43, 42, 40, 42, 41, 42, 42, 42];
const STRESS_WORDS = ["urgent", "asap", "deadline", "overwhelmed", "worried", "anxious", "pressure", "impossible", "can't", "cannot", "problem", "angry", "frustrated", "exhausted", "failing", "fail", "hate", "stuck", "panic", "terrible"];
const CALM_WORDS = ["calm", "manageable", "confident", "relaxed", "steady", "okay", "fine", "good", "comfortable", "prepared", "supported"];

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const deviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

function levelFor(score: number | null) {
  if (score === null) return { label: "READY", tone: "idle", copy: "Start a session or enter text to create a multimodal estimate." };
  if (score >= 70) return { label: "HIGH", tone: "high", copy: "Several signals suggest sustained tension. A short reset may help." };
  if (score >= 40) return { label: "MODERATE", tone: "moderate", copy: "Some tension is present. CallCoach will keep watching the pattern." };
  return { label: "STEADY", tone: "low", copy: "The available expression, voice, and language signals look relatively steady." };
}

function estimatePitch(samples: Float32Array, sampleRate: number) {
  let rms = 0;
  for (const sample of samples) rms += sample * sample;
  rms = Math.sqrt(rms / samples.length);
  if (rms < 0.012) return { pitch: 0, rms };
  const minOffset = Math.floor(sampleRate / 380);
  const maxOffset = Math.min(Math.floor(sampleRate / 70), samples.length - 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;
    for (let index = 0; index < samples.length - offset; index += 1) {
      correlation += samples[index] * samples[index + offset];
    }
    correlation /= samples.length - offset;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }
  return { pitch: bestOffset > 0 && bestCorrelation > 0.002 ? sampleRate / bestOffset : 0, rms };
}

function analyzeLanguage(text: string) {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return { score: null as number | null, keywords: [] as string[], density: 0 };
  const stressHits = STRESS_WORDS.filter((word) => words.includes(word));
  const calmHits = CALM_WORDS.filter((word) => words.includes(word));
  const exclamations = (text.match(/!/g) ?? []).length;
  const repeatedPunctuation = (text.match(/[!?]{2,}/g) ?? []).length;
  const uppercaseWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const density = stressHits.length / words.length;
  const calmDensity = calmHits.length / words.length;
  const score = clamp(26 + density * 155 + exclamations * 4 + repeatedPunctuation * 9 + uppercaseWords * 5 - calmDensity * 110);
  return { score: Math.round(score), keywords: stressHits.slice(0, 6), density: Math.round(density * 100) };
}

function Sparkline({ values, color = "mint", label = "Recent stress trend" }: { values: number[]; color?: "mint" | "violet"; label?: string }) {
  const width = 620;
  const height = 126;
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - (clamp(value) / 100) * (height - 20) - 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = points.split(" ").at(-1)?.split(",") ?? ["0", "0"];
  return (
    <svg className={`sparkline ${color}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={`area-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color === "mint" ? "#5ef2c2" : "#a99bff"} stopOpacity=".34" />
          <stop offset="1" stopColor={color === "mint" ? "#5ef2c2" : "#a99bff"} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`line-${color}`} x1="0" x2="1">
          <stop offset="0" stopColor="#5ef2c2" />
          <stop offset=".55" stopColor="#91dcff" />
          <stop offset="1" stopColor="#a99bff" />
        </linearGradient>
      </defs>
      <line x1="0" y1="38" x2={width} y2="38" className="chart-grid" />
      <line x1="0" y1="78" x2={width} y2="78" className="chart-grid" />
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#area-${color})`} />
      <polyline points={points} fill="none" stroke={`url(#line-${color})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="6" className="chart-dot" />
    </svg>
  );
}

function NatureScene({ kind, compact = false }: { kind: EnvironmentKey; compact?: boolean }) {
  return (
    <div className={`nature-scene ${kind} ${compact ? "compact" : ""}`} aria-hidden="true">
      <div className="scene-glow" />
      {kind === "forest" && <><div className="moon" /><div className="mountain mountain-one" /><div className="mountain mountain-two" /><div className="tree-line tree-back" /><div className="tree-line tree-front" />{Array.from({ length: compact ? 4 : 12 }).map((_, index) => <i className="firefly" key={index} style={{ "--i": index } as React.CSSProperties} />)}</>}
      {kind === "ocean" && <><div className="ocean-moon" /><div className="wave wave-one" /><div className="wave wave-two" /><div className="wave wave-three" /></>}
      {kind === "rain" && <><div className="rain-window" />{Array.from({ length: compact ? 7 : 24 }).map((_, index) => <i className="rain-drop" key={index} style={{ "--i": index } as React.CSSProperties} />)}<div className="rain-leaf" /></>}
    </div>
  );
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceLandmarkerLike | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceSamplesRef = useRef<Float32Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFaceRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const lastFusionRef = useRef(0);
  const lastHistoryRef = useRef(0);
  const faceBaselineRef = useRef<number[]>([]);
  const pitchBaselineRef = useRef<number[]>([]);
  const energyBaselineRef = useRef<number[]>([]);
  const pitchWindowRef = useRef<number[]>([]);
  const calibrationStartedRef = useRef(0);
  const highStressStartedRef = useRef<number | null>(null);
  const speechStartedRef = useRef<number | null>(null);
  const spokenWordsRef = useRef(0);
  const lastVoiceActivityRef = useRef(0);
  const statusRef = useRef<AnalysisStatus>("idle");
  const autoInterventionRef = useRef(true);
  const faceScoreRef = useRef<number | null>(null);
  const voiceScoreRef = useRef<number | null>(null);
  const languageScoreRef = useRef<number | null>(null);
  const hasFaceRef = useRef(false);
  const fusedScoreRef = useRef(38);
  const fusedInitializedRef = useRef(false);
  const soundContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const interventionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Camera and microphone are ready when you are");
  const [hasFace, setHasFace] = useState(false);
  const [stressScore, setStressScore] = useState<number | null>(null);
  const [faceScore, setFaceScore] = useState<number | null>(null);
  const [voiceScore, setVoiceScore] = useState<number | null>(null);
  const [fusionConfidence, setFusionConfidence] = useState(0);
  const [history, setHistory] = useState<number[]>(initialHistory);
  const [calibration, setCalibration] = useState(0);
  const [selectedEnvironment, setSelectedEnvironment] = useState<EnvironmentKey>("forest");
  const [activeTab, setActiveTab] = useState("analysis");
  const [faceSignals, setFaceSignals] = useState({ brow: 0, eyes: 0, jaw: 0, smile: 0 });
  const [emotion, setEmotion] = useState({ label: "Waiting for face", confidence: 0 });
  const [pitchHz, setPitchHz] = useState(0);
  const [pitchVariation, setPitchVariation] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [speakingRate, setSpeakingRate] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechStatus, setSpeechStatus] = useState("Transcript waiting");
  const [autoIntervention, setAutoIntervention] = useState(true);
  const [recommendation, setRecommendation] = useState(false);
  const [interventionOpen, setInterventionOpen] = useState(false);
  const [interventionPlaying, setInterventionPlaying] = useState(false);
  const [interventionSeconds, setInterventionSeconds] = useState(300);
  const [breathPhase, setBreathPhase] = useState("Inhale");
  const [volume, setVolume] = useState(42);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
  const [interventionCount, setInterventionCount] = useState(0);
  const [sessionError, setSessionError] = useState("");

  const currentLevel = levelFor(stressScore);
  const displayHistory = stressScore === null ? initialHistory : history;
  const sessionAverage = stressScore === null ? 0 : Math.round(average(history));
  const sessionPeak = stressScore === null ? 0 : Math.max(...history);
  const steadyRatio = stressScore === null ? 0 : Math.round((history.filter((value) => value < 40).length / history.length) * 100);
  const combinedText = `${transcript} ${manualText}`.trim();
  const languageAnalysis = useMemo(() => analyzeLanguage(combinedText), [combinedText]);
  const languageScore = languageAnalysis.score;
  const textKeywords = languageAnalysis.keywords;
  const textDensity = languageAnalysis.density;

  const categoryScore = useCallback((map: Map<string, number>, ...names: string[]) => average(names.map((name) => map.get(name) ?? 0)), []);

  const drawFaceGuide = useCallback((landmarks?: Point[]) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!landmarks?.length) return;
    const xs = landmarks.map((point) => point.x * width);
    const ys = landmarks.map((point) => point.y * height);
    const left = Math.min(...xs) - 20;
    const right = Math.max(...xs) + 20;
    const top = Math.min(...ys) - 28;
    const bottom = Math.max(...ys) + 28;
    const corner = Math.min(54, (right - left) * 0.18);
    context.strokeStyle = "rgba(94, 242, 194, .88)";
    context.lineWidth = 3;
    context.shadowBlur = 14;
    context.shadowColor = "rgba(94, 242, 194, .45)";
    context.beginPath();
    context.moveTo(left + corner, top); context.lineTo(left, top); context.lineTo(left, top + corner);
    context.moveTo(right - corner, top); context.lineTo(right, top); context.lineTo(right, top + corner);
    context.moveTo(left, bottom - corner); context.lineTo(left, bottom); context.lineTo(left + corner, bottom);
    context.moveTo(right, bottom - corner); context.lineTo(right, bottom); context.lineTo(right - corner, bottom);
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "rgba(94, 242, 194, .7)";
    [33, 133, 362, 263, 1, 61, 291, 152].forEach((index) => {
      const point = landmarks[index];
      if (!point) return;
      context.beginPath(); context.arc(point.x * width, point.y * height, 2.5, 0, Math.PI * 2); context.fill();
    });
  }, []);

  const processFace = useCallback((categories: Blendshape[], now: number) => {
    const scores = new Map(categories.map((item) => [item.categoryName, item.score]));
    const browDown = categoryScore(scores, "browDownLeft", "browDownRight");
    const browInnerUp = scores.get("browInnerUp") ?? 0;
    const eyeSquint = categoryScore(scores, "eyeSquintLeft", "eyeSquintRight");
    const eyeWide = categoryScore(scores, "eyeWideLeft", "eyeWideRight");
    const jawOpen = scores.get("jawOpen") ?? 0;
    const lipPress = categoryScore(scores, "mouthPressLeft", "mouthPressRight");
    const frown = categoryScore(scores, "mouthFrownLeft", "mouthFrownRight");
    const smile = categoryScore(scores, "mouthSmileLeft", "mouthSmileRight");
    const tension = browDown * 0.29 + browInnerUp * 0.16 + eyeSquint * 0.18 + eyeWide * 0.12 + lipPress * 0.13 + frown * 0.08 + jawOpen * 0.04;
    const raw = clamp(18 + tension * 145 - smile * 22);
    if (statusRef.current === "calibrating") faceBaselineRef.current.push(raw);
    const baseline = average(faceBaselineRef.current) || 26;
    const score = Math.round(clamp(32 + (raw - baseline) * 1.42 + tension * 25));
    faceScoreRef.current = score;
    setFaceScore(score);
    setFaceSignals({
      brow: Math.round(clamp((browDown + browInnerUp * 0.5) * 100)),
      eyes: Math.round(clamp((eyeSquint + eyeWide * 0.6) * 100)),
      jaw: Math.round(clamp((jawOpen * 0.45 + lipPress) * 100)),
      smile: Math.round(clamp(smile * 100)),
    });
    const candidates = [
      { label: "Tension", value: browDown + eyeSquint + lipPress },
      { label: "Concern", value: browInnerUp + eyeWide + frown * 0.45 },
      { label: "Positive", value: smile * 2.2 },
      { label: "Surprise", value: jawOpen + eyeWide },
      { label: "Neutral", value: Math.max(0.18, 1.15 - tension - smile * 0.7) },
    ].sort((a, b) => b.value - a.value);
    const total = candidates.reduce((sum, item) => sum + item.value, 0) || 1;
    setEmotion({ label: candidates[0].label, confidence: Math.round((candidates[0].value / total) * 100) });
    lastFaceRef.current = now;
  }, [categoryScore]);

  const processVoice = useCallback((now: number) => {
    lastVoiceRef.current = now;
    const analyser = voiceAnalyserRef.current;
    const context = voiceContextRef.current;
    if (!analyser || !context) return;
    if (!voiceSamplesRef.current || voiceSamplesRef.current.length !== analyser.fftSize) voiceSamplesRef.current = new Float32Array(analyser.fftSize);
    const samples = voiceSamplesRef.current;
    analyser.getFloatTimeDomainData(samples);
    const { pitch, rms } = estimatePitch(samples, context.sampleRate);
    const speaking = rms > 0.014;
    setIsSpeaking(speaking);
    setVoiceLevel(Math.round(clamp(rms * 900)));
    if (!speaking) return;
    lastVoiceActivityRef.current = now;
    if (pitch > 65 && pitch < 420) {
      pitchWindowRef.current = [...pitchWindowRef.current.slice(-29), pitch];
      setPitchHz(Math.round(pitch));
    }
    if (statusRef.current === "calibrating") {
      if (pitch > 65 && pitch < 420) pitchBaselineRef.current.push(pitch);
      energyBaselineRef.current.push(rms);
    }
    const pitchBase = average(pitchBaselineRef.current) || average(pitchWindowRef.current) || 165;
    const energyBase = average(energyBaselineRef.current) || 0.035;
    const pitchElevation = pitch > 0 ? clamp(((pitch - pitchBase) / pitchBase) * 100) : 0;
    const variability = pitchWindowRef.current.length > 4 ? deviation(pitchWindowRef.current) / (average(pitchWindowRef.current) || 1) : 0;
    const energyElevation = clamp(((rms - energyBase) / energyBase) * 100);
    const elapsedMinutes = speechStartedRef.current ? Math.max((Date.now() - speechStartedRef.current) / 60000, 0.08) : 0;
    const wpm = elapsedMinutes ? Math.round(spokenWordsRef.current / elapsedMinutes) : 0;
    if (wpm > 0) setSpeakingRate(Math.min(wpm, 260));
    const pacePressure = wpm > 160 ? (wpm - 160) * 0.52 : wpm > 125 ? (wpm - 125) * 0.18 : 0;
    const score = Math.round(clamp(25 + pitchElevation * 0.55 + energyElevation * 0.3 + variability * 75 + pacePressure));
    voiceScoreRef.current = score;
    setVoiceScore(score);
    setPitchVariation(Math.round(variability * 100));
  }, []);

  const updateFusion = useCallback((now: number) => {
    if (now - lastFusionRef.current < 220) return;
    lastFusionRef.current = now;
    const inputs: Array<{ score: number; weight: number }> = [];
    if (hasFaceRef.current && faceScoreRef.current !== null) inputs.push({ score: faceScoreRef.current, weight: 0.4 });
    if (voiceScoreRef.current !== null && now - lastVoiceActivityRef.current < 4500) inputs.push({ score: voiceScoreRef.current, weight: 0.35 });
    if (languageScoreRef.current !== null) inputs.push({ score: languageScoreRef.current, weight: 0.25 });
    if (!inputs.length) return;
    const weight = inputs.reduce((sum, input) => sum + input.weight, 0);
    const raw = inputs.reduce((sum, input) => sum + input.score * input.weight, 0) / weight;
    fusedScoreRef.current = fusedInitializedRef.current && statusRef.current !== "idle"
      ? fusedScoreRef.current * 0.82 + raw * 0.18
      : raw;
    fusedInitializedRef.current = true;
    const score = Math.round(clamp(fusedScoreRef.current));
    setStressScore(score);
    setFusionConfidence(Math.round(weight * 100));
    if (now - lastHistoryRef.current > 1000) {
      lastHistoryRef.current = now;
      setHistory((previous) => [...previous.slice(-59), score]);
    }
    if (score >= 70) {
      if (!highStressStartedRef.current) highStressStartedRef.current = now;
      if (autoInterventionRef.current && now - highStressStartedRef.current > 6000) setRecommendation(true);
    } else highStressStartedRef.current = null;
  }, []);

  const analysisLoop = useCallback(() => {
    const now = performance.now();
    if (statusRef.current === "calibrating") {
      const progress = clamp(((now - calibrationStartedRef.current) / 5000) * 100);
      setCalibration(Math.round(progress));
      if (progress >= 100) {
        statusRef.current = "running";
        setStatus("running");
        setStatusMessage("Multimodal analysis is live");
      }
    }
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (video && detector && video.readyState >= 2 && now - lastFaceRef.current > 100) {
      lastFaceRef.current = now;
      try {
        const result = detector.detectForVideo(video, now);
        const face = result.faceLandmarks?.[0];
        const categories = result.faceBlendshapes?.[0]?.categories;
        const detected = Boolean(face?.length && categories?.length);
        hasFaceRef.current = detected;
        setHasFace(detected);
        drawFaceGuide(face);
        if (detected && categories) processFace(categories, now);
      } catch { /* A dropped vision frame should not end the session. */ }
    }
    if (now - lastVoiceRef.current > 100) processVoice(now);
    updateFusion(now);
    rafRef.current = requestAnimationFrame(analysisLoop);
  }, [drawFaceGuide, processFace, processVoice, updateFusion]);

  const loadDetector = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current;
    setStatusMessage("Loading the on-device vision model");
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
    const options = {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" as const },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
      runningMode: "VIDEO" as const,
      numFaces: 1,
    };
    try {
      detectorRef.current = await vision.FaceLandmarker.createFromOptions(fileset, options) as unknown as FaceLandmarkerLike;
    } catch {
      detectorRef.current = await vision.FaceLandmarker.createFromOptions(fileset, { ...options, baseOptions: { modelAssetPath: options.baseOptions.modelAssetPath } }) as unknown as FaceLandmarkerLike;
    }
    return detectorRef.current;
  }, []);

  const startSpeechRecognition = useCallback(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setSpeechSupported(false); setSpeechStatus("Live transcription is not supported here — use the text box below"); return; }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalChunk = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalChunk += ` ${result[0].transcript}`;
        else interim += ` ${result[0].transcript}`;
      }
      if (finalChunk.trim()) {
        const count = finalChunk.trim().split(/\s+/).length;
        spokenWordsRef.current += count;
        if (!speechStartedRef.current) speechStartedRef.current = Date.now();
        setTranscript((previous) => `${previous} ${finalChunk}`.replace(/\s+/g, " ").trim());
      }
      setInterimTranscript(interim.trim());
      setSpeechStatus("Listening · English (US)");
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") setSpeechStatus(`Transcript paused: ${event.error}`);
    };
    recognition.onend = () => {
      if (statusRef.current === "running" || statusRef.current === "calibrating") {
        window.setTimeout(() => { try { recognition.start(); } catch { /* Already restarting. */ } }, 300);
      }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); setSpeechStatus("Listening · English (US)"); } catch { setSpeechStatus("Transcript could not start — manual input is available"); }
  }, []);

  const stopAnalysis = useCallback(() => {
    statusRef.current = "idle";
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (voiceContextRef.current) void voiceContextRef.current.close();
    voiceContextRef.current = null;
    voiceAnalyserRef.current = null;
    const context = overlayRef.current?.getContext("2d");
    if (context && overlayRef.current) context.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    setStatus("idle");
    setHasFace(false);
    hasFaceRef.current = false;
    setIsSpeaking(false);
    setStatusMessage("Camera and microphone are ready when you are");
    setSpeechStatus("Transcript paused");
  }, []);

  const startAnalysis = useCallback(async () => {
    setSessionError("");
    setStatus("loading");
    statusRef.current = "loading";
    setStatusMessage("Requesting camera and microphone access");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support camera and microphone capture.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("The video surface is not available.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const voiceContext = new AudioContext();
      await voiceContext.resume();
      const source = voiceContext.createMediaStreamSource(stream);
      const analyser = voiceContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.38;
      source.connect(analyser);
      voiceContextRef.current = voiceContext;
      voiceAnalyserRef.current = analyser;
      faceBaselineRef.current = [];
      pitchBaselineRef.current = [];
      energyBaselineRef.current = [];
      pitchWindowRef.current = [];
      spokenWordsRef.current = 0;
      speechStartedRef.current = null;
      calibrationStartedRef.current = performance.now();
      lastHistoryRef.current = performance.now();
      setCalibration(0);
      setSessionStartedAt(new Date());
      setStatus("calibrating");
      statusRef.current = "calibrating";
      setStatusMessage("Calibrating your personal baseline");
      startSpeechRecognition();
      void loadDetector().catch(() => setStatusMessage("Voice and language are live; vision model is unavailable"));
      rafRef.current = requestAnimationFrame(analysisLoop);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setStatus("error");
      statusRef.current = "error";
      setStatusMessage("The multimodal session could not start");
      const message = error instanceof Error ? error.message : "Check your camera and microphone settings.";
      setSessionError(/Permission|denied|NotAllowed/i.test(message) ? "Camera or microphone access is blocked. Allow both permissions in your browser and try again." : message);
    }
  }, [analysisLoop, loadDetector, startSpeechRecognition]);

  const stopSoundscape = useCallback(() => {
    if (soundContextRef.current) void soundContextRef.current.close();
    soundContextRef.current = null;
    masterGainRef.current = null;
    setInterventionPlaying(false);
  }, []);

  const startSoundscape = useCallback(async (kind: EnvironmentKey) => {
    stopSoundscape();
    const context = new AudioContext();
    await context.resume();
    const master = context.createGain();
    master.gain.value = (volume / 100) * 0.48;
    master.connect(context.destination);
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = brown * 0.985 + white * 0.035;
      data[index] = kind === "rain" ? white * 0.55 + brown * 0.25 : brown * 2.4;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = kind === "rain" ? "highpass" : "lowpass";
    filter.frequency.value = kind === "forest" ? 1700 : kind === "ocean" ? 820 : 920;
    const noiseGain = context.createGain();
    noiseGain.gain.value = kind === "forest" ? 0.18 : kind === "ocean" ? 0.32 : 0.24;
    noise.connect(filter).connect(noiseGain).connect(master);
    if (kind === "ocean") {
      const lfo = context.createOscillator(); const lfoGain = context.createGain();
      lfo.frequency.value = 0.08; lfoGain.gain.value = 0.14; lfo.connect(lfoGain).connect(noiseGain.gain); lfo.start();
    }
    if (kind === "forest") {
      [392, 523].forEach((frequency, index) => {
        const tone = context.createOscillator(); const gain = context.createGain();
        tone.type = "sine"; tone.frequency.value = frequency; gain.gain.value = 0.006 - index * 0.0015; tone.connect(gain).connect(master); tone.start();
      });
    }
    noise.start(); soundContextRef.current = context; masterGainRef.current = master; setInterventionPlaying(true);
  }, [stopSoundscape, volume]);

  const openIntervention = useCallback(() => {
    setRecommendation(false); setInterventionSeconds(300); setInterventionOpen(true); setInterventionCount((count) => count + 1);
    window.setTimeout(() => void startSoundscape(selectedEnvironment), 80);
  }, [selectedEnvironment, startSoundscape]);

  const closeIntervention = useCallback(() => {
    stopSoundscape(); setInterventionOpen(false);
    if (interventionTimerRef.current) clearInterval(interventionTimerRef.current);
  }, [stopSoundscape]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      languageScoreRef.current = languageScore;
      if (languageScore !== null) updateFusion(performance.now() + 250);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [languageScore, updateFusion]);

  useEffect(() => {
    if (!interventionOpen) return;
    const started = Date.now();
    const breathTimer = window.setInterval(() => {
      const cycle = ((Date.now() - started) / 1000) % 12;
      setBreathPhase(cycle < 4 ? "Inhale" : cycle < 6 ? "Hold" : "Exhale");
    }, 250);
    interventionTimerRef.current = setInterval(() => setInterventionSeconds((seconds) => {
      if (seconds <= 1) { closeIntervention(); return 0; }
      return seconds - 1;
    }), 1000);
    return () => { clearInterval(breathTimer); if (interventionTimerRef.current) clearInterval(interventionTimerRef.current); };
  }, [closeIntervention, interventionOpen]);

  useEffect(() => { if (masterGainRef.current) masterGainRef.current.gain.value = (volume / 100) * 0.48; }, [volume]);
  useEffect(() => { autoInterventionRef.current = autoIntervention; }, [autoIntervention]);
  useEffect(() => { document.body.style.overflow = interventionOpen ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [interventionOpen]);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    statusRef.current = "idle";
    recognitionRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    detectorRef.current?.close();
    if (voiceContextRef.current) void voiceContextRef.current.close();
    if (soundContextRef.current) void soundContextRef.current.close();
  }, []);

  const selectEnvironment = (kind: EnvironmentKey) => {
    setSelectedEnvironment(kind);
    if (interventionPlaying) void startSoundscape(kind);
  };
  const jumpTo = (tab: string, id: string) => { setActiveTab(tab); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const exportSession = () => {
    const payload = {
      product: "CallCoach Live", exportedAt: new Date().toISOString(), sessionStartedAt: sessionStartedAt?.toISOString() ?? null,
      summary: { fusedStress: stressScore, confidence: fusionConfidence, faceStress: faceScore, voiceStress: voiceScore, languageStress: languageScore, speakingRateWpm: speakingRate, pitchHz, pitchVariationPercent: pitchVariation, sessionAverage, sessionPeak, steadyRatio, interventionCount },
      transcript, samples: history.map((score, index) => ({ secondsAgo: history.length - index - 1, stressScore: score })),
      note: "A multimodal wellness estimate, not a medical or psychological diagnosis.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `callcoach-session-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const remaining = `${Math.floor(interventionSeconds / 60)}:${String(interventionSeconds % 60).padStart(2, "0")}`;
  const faceAvailable = faceScore !== null && hasFace;
  const voiceAvailable = voiceScore !== null;
  const languageAvailable = languageScore !== null;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <button className="brand" onClick={() => jumpTo("analysis", "analysis")} aria-label="CallCoach Live home"><span>CallCoach</span> <strong>Live</strong></button>
        <nav aria-label="Primary navigation">
          <button className={activeTab === "analysis" ? "active" : ""} onClick={() => jumpTo("analysis", "analysis")}>Analyze</button>
          <button className={activeTab === "intervention" ? "active" : ""} onClick={() => jumpTo("intervention", "intervention")}>Intervene</button>
          <button className={activeTab === "session" ? "active" : ""} onClick={() => jumpTo("session", "session")}>Session</button>
        </nav>
        <div className={`live-pill ${status}`}><span className="live-dot" />{status === "running" ? "MULTIMODAL LIVE" : status === "calibrating" ? "CALIBRATING" : status === "loading" ? "PREPARING" : "READY"}</div>
      </header>

      <section className="hero-grid" id="analysis">
        <article className="camera-panel panel">
          <div className="camera-stage">
            <video ref={videoRef} muted playsInline aria-label="Live camera feed" /><canvas ref={overlayRef} aria-hidden="true" />
            {(status === "idle" || status === "error") && (
              <div className="camera-empty">
                <div className="multimodal-orbit"><Video size={27} /><Mic size={22} /><MessageSquareText size={22} /></div>
                <p className="eyebrow">FACE · VOICE · LANGUAGE</p>
                <h1>See, hear, and understand<br />the moment.</h1>
                <p>CallCoach combines facial movement, pitch and speaking pace, and the words you use into one confidence-aware stress estimate.</p>
                <button className="primary camera-start" onClick={startAnalysis}><Camera size={18} /><Mic size={18} /> Start multimodal session</button>
                <div className="permission-row"><span><Video size={13} /> Camera</span><span><Mic size={13} /> Microphone</span><span><MessageSquareText size={13} /> English transcript</span></div>
                {sessionError && <div className="camera-error" role="alert"><Info size={16} /> {sessionError}</div>}
              </div>
            )}
            {status === "loading" && <div className="loading-layer"><span className="model-loader" /><strong>{statusMessage}</strong><p>The first model load may take a few seconds.</p></div>}
            {status === "calibrating" && <div className="calibration-card"><div className="calibration-ring" style={{ "--progress": `${calibration * 3.6}deg` } as React.CSSProperties}><span>{calibration}%</span></div><div><strong>Personal baseline calibration</strong><p>Look forward and speak naturally for five seconds.</p></div></div>}
            {(status === "running" || status === "calibrating") && <>
              <div className={`face-status ${hasFace ? "found" : "lost"}`}><span />{hasFace ? "Face signal locked" : "Center your face in frame"}</div>
              <div className={`voice-live-badge ${isSpeaking ? "speaking" : ""}`}><AudioLines size={16} /><span>{isSpeaking ? `${pitchHz || "—"} Hz · voice active` : "Listening for speech"}</span></div>
              <div className="privacy-badge"><ShieldCheck size={18} /> Features processed locally</div>
              <button className="stop-camera" onClick={stopAnalysis}><CameraOff size={15} /><MicOff size={15} /> End session</button>
            </>}
          </div>
          <div className="camera-meta multimodal-meta">
            <div><span className="meta-icon"><Eye size={17} /></span><p><strong>Face</strong><small>52 blendshapes · 10 FPS</small></p></div>
            <div><span className="meta-icon blue"><AudioLines size={17} /></span><p><strong>Voice</strong><small>Pitch · pace · intensity</small></p></div>
            <div><span className="meta-icon violet"><MessageSquareText size={17} /></span><p><strong>Language</strong><small>Live or typed English text</small></p></div>
          </div>
        </article>

        <div className="analysis-column multimodal-analysis">
          <article className="score-card panel">
            <div className="section-heading"><div><span className="eyebrow">WEIGHTED FUSION</span><h2>Multimodal stress</h2></div><Gauge size={21} /></div>
            <div className="score-row"><div className="score-number"><strong>{stressScore ?? "--"}</strong><span>/100</span></div><div className={`level-chip ${currentLevel.tone}`}>{currentLevel.label}</div><div className="gauge-ring" style={{ "--score": `${stressScore ?? 0}%` } as React.CSSProperties}><HeartPulse size={28} /></div></div>
            <div className="confidence-row"><span>{currentLevel.copy}</span><strong>{fusionConfidence}% signal confidence</strong></div>
          </article>

          <article className="fusion-card panel">
            <div className="card-title-row"><div><span className="eyebrow">ACTIVE INPUTS</span><h3>Signal contribution</h3></div><span className="trend-value">Weights renormalize when a signal is missing</span></div>
            <div className="fusion-inputs">
              {[
                { label: "Face", score: faceScore, available: faceAvailable, weight: "40%", icon: Eye, tone: "mint" },
                { label: "Voice", score: voiceScore, available: voiceAvailable, weight: "35%", icon: AudioLines, tone: "blue" },
                { label: "Language", score: languageScore, available: languageAvailable, weight: "25%", icon: MessageSquareText, tone: "violet" },
              ].map((item) => <div className={`fusion-input ${item.available ? "available" : ""}`} key={item.label}><span className={`fusion-icon ${item.tone}`}><item.icon size={16} /></span><p><small>{item.label} · {item.weight}</small><strong>{item.available ? item.score : "Waiting"}</strong></p><div className="mini-track"><i className={item.tone} style={{ width: `${item.score ?? 0}%` }} /></div></div>)}
            </div>
          </article>

          <article className="trend-card panel">
            <div className="card-title-row"><div><span className="eyebrow">TEMPORAL SMOOTHING</span><h3>Last 60 seconds</h3></div><span className="trend-value">{stressScore === null ? "Waiting for signals" : `${stressScore >= (history.at(-2) ?? stressScore) ? "+" : ""}${stressScore - (history.at(-2) ?? stressScore)} change`}</span></div>
            <Sparkline values={displayHistory} />
          </article>

          <article className="nature-card compact-nature panel" id="intervention">
            <div className="card-title-row"><div><span className="eyebrow">JUST-IN-TIME RESET</span><h3>Nature intervention</h3></div><span className="sound-note"><Volume2 size={14} /> synthesized sound</span></div>
            <div className="nature-options">
              {(Object.keys(environments) as EnvironmentKey[]).map((kind) => { const item = environments[kind]; const Icon = item.icon; return <button key={kind} className={`nature-option ${selectedEnvironment === kind ? "selected" : ""}`} onClick={() => selectEnvironment(kind)} aria-pressed={selectedEnvironment === kind}><NatureScene kind={kind} compact /><span><Icon size={17} />{item.short}</span>{selectedEnvironment === kind && <i className="selected-check"><Check size={11} /></i>}</button>; })}
            </div>
            <button className="primary intervention-cta" onClick={openIntervention}><Leaf size={20} /> Start nature reset <ChevronRight size={18} /></button>
          </article>
        </div>
      </section>

      <div className="wellness-note"><span /><ShieldCheck size={16} />A wellness support tool, not a medical diagnosis<span /></div>

      {recommendation && <aside className="recommendation-toast" role="status"><div className="toast-icon"><Sparkles size={21} /></div><div><strong>A short reset may help</strong><p>High fused stress has continued for more than six seconds.</p></div><button onClick={openIntervention}>Start 2-minute reset</button><button className="icon-button" onClick={() => setRecommendation(false)} aria-label="Dismiss recommendation"><X size={17} /></button></aside>}

      <section className="modality-section section-wrap">
        <div className="section-intro"><div><span className="eyebrow">MULTIMODAL OBSERVATORY</span><h2>Three views of the same moment</h2><p>Each modality stays visible so you can see what is shaping the fused estimate.</p></div></div>
        <div className="modality-grid">
          <article className="modality-card panel face-modality">
            <div className="modality-head"><span className="modality-icon mint"><Eye size={20} /></span><div><small>VISUAL SIGNAL</small><h3>Facial expression</h3></div><strong>{faceScore ?? "—"}</strong></div>
            <div className="emotion-summary"><div><span className="emotion-orb"><Zap size={21} /></span><p><small>Dominant pattern</small><strong>{emotion.label}</strong></p></div><span>{emotion.confidence}% relative strength</span></div>
            <div className="signal-bars">
              {[["Brow tension", faceSignals.brow, "mint"], ["Eye tension", faceSignals.eyes, "blue"], ["Jaw / lip tension", faceSignals.jaw, "violet"], ["Positive expression", faceSignals.smile, "soft"]].map(([label, value, tone]) => <div className="signal-row" key={String(label)}><div><span>{label}</span><strong>{value}%</strong></div><div className="bar-track"><i className={String(tone)} style={{ width: `${value}%` }} /></div></div>)}
            </div>
          </article>

          <article className="modality-card panel voice-modality">
            <div className="modality-head"><span className="modality-icon blue"><AudioLines size={20} /></span><div><small>VOCAL PROSODY</small><h3>Voice dynamics</h3></div><strong>{voiceScore ?? "—"}</strong></div>
            <div className="voice-wave" aria-label="Live voice intensity visualization">{Array.from({ length: 28 }).map((_, index) => <i key={index} style={{ height: `${Math.max(8, Math.min(100, voiceLevel * (0.42 + ((index * 7) % 13) / 12)))}%`, animationDelay: `${index * -35}ms` }} />)}</div>
            <div className="voice-metrics">
              <div><span>Pitch</span><strong>{pitchHz ? `${pitchHz} Hz` : "—"}<small>current</small></strong></div>
              <div><span>Pitch variability</span><strong>{pitchVariation ? `${pitchVariation}%` : "—"}<small>rolling window</small></strong></div>
              <div><span>Speaking pace</span><strong>{speakingRate ? `${speakingRate} wpm` : "—"}<small>final words</small></strong></div>
              <div><span>Intensity</span><strong>{voiceLevel ? `${voiceLevel}%` : "—"}<small>local RMS</small></strong></div>
            </div>
          </article>

          <article className="modality-card panel language-modality">
            <div className="modality-head"><span className="modality-icon violet"><MessageSquareText size={20} /></span><div><small>LINGUISTIC SIGNAL</small><h3>Words and phrasing</h3></div><strong>{languageScore ?? "—"}</strong></div>
            <div className="transcript-status"><span className={`live-dot ${status === "running" && speechSupported ? "active" : ""}`} />{speechStatus}</div>
            <div className="transcript-box" aria-live="polite"><p>{transcript || "Your live transcript will appear here as you speak."}</p>{interimTranscript && <span>{interimTranscript}</span>}</div>
            <label className="manual-text-label" htmlFor="manual-text">Add or paste text for analysis</label>
            <textarea id="manual-text" value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="Example: I am worried about this urgent deadline and feel completely overwhelmed..." />
            <div className="language-meta"><span>{combinedText ? `${combinedText.split(/\s+/).filter(Boolean).length} words` : "0 words"}</span><span>{textDensity}% stress-word density</span><div className="keyword-list">{textKeywords.length ? textKeywords.map((word) => <i key={word}>{word}</i>) : <em>No high-pressure terms detected</em>}</div></div>
          </article>
        </div>
      </section>

      <section className="detail-grid section-wrap controls-detail">
        <article className="method-panel panel">
          <div className="section-heading"><div><span className="eyebrow">FUSION METHOD</span><h2>How the estimate is composed</h2></div><Brain size={22} /></div>
          <div className="method-flow">
            <div><span className="method-number">01</span><p><strong>Calibrate</strong><small>A five-second baseline adapts face, pitch, and intensity features to you.</small></p></div>
            <div><span className="method-number">02</span><p><strong>Normalize</strong><small>Each modality produces a transparent 0–100 relative tension score.</small></p></div>
            <div><span className="method-number">03</span><p><strong>Fuse</strong><small>Face 40%, voice 35%, language 25%; available weights are automatically renormalized.</small></p></div>
            <div><span className="method-number">04</span><p><strong>Stabilize</strong><small>An exponential moving average reduces sudden one-frame jumps.</small></p></div>
          </div>
          <div className="formula-note"><Info size={15} /><p><strong>Interpretation matters</strong><span>A high score means several observable signals moved away from the calibrated baseline. It does not reveal a diagnosis, intention, or inner emotional state.</span></p></div>
        </article>
        <article className="controls-panel panel">
          <div className="section-heading"><div><span className="eyebrow">COACH SETTINGS</span><h2>Intervention settings</h2></div><SlidersHorizontal size={22} /></div>
          <label className="toggle-row"><span><strong>Automatic reset prompt</strong><small>Suggest a reset after six seconds of high fused stress</small></span><input type="checkbox" checked={autoIntervention} onChange={(event) => setAutoIntervention(event.target.checked)} /><i /></label>
          <div className="volume-row"><div><span><Volume2 size={16} />Soundscape volume</span><strong>{volume}%</strong></div><input type="range" min="0" max="100" value={volume} style={{ "--range": `${volume}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Soundscape volume" /></div>
          <div className="privacy-list">
            <div><LockKeyhole size={17} /><span><strong>Camera frames</strong><small>Never uploaded, recorded, or stored</small></span><Check size={16} /></div>
            <div><Mic size={17} /><span><strong>Voice features</strong><small>Pitch and intensity computed in this tab</small></span><Check size={16} /></div>
            <div><MessageSquareText size={17} /><span><strong>Live transcription</strong><small>May use your browser&apos;s speech service; manual text stays in this tab</small></span><Info size={16} /></div>
          </div>
        </article>
      </section>

      <section className="session-section section-wrap" id="session">
        <div className="section-intro"><div><span className="eyebrow">SESSION OBSERVATORY</span><h2>Session insight</h2><p>Use the pattern to notice recovery opportunities, not to judge performance.</p></div><button className="secondary" onClick={exportSession} disabled={stressScore === null}><Download size={17} />Export JSON</button></div>
        <div className="session-grid">
          <article className="session-chart panel"><div className="chart-head"><div><span>Full session</span><strong>{sessionStartedAt ? "Session in progress" : "Waiting to begin"}</strong></div><span className="session-date">Today · current tab</span></div><Sparkline values={displayHistory} color="violet" label="Full-session fused stress trend" /><div className="chart-legend"><span><i className="mint" />Steady 0–39</span><span><i className="violet" />Moderate 40–69</span><span><i className="red" />High 70–100</span></div></article>
          <div className="stat-grid"><article className="stat-card panel"><span><Activity size={17} />Average</span><strong>{stressScore === null ? "--" : sessionAverage}</strong><small>/100</small></article><article className="stat-card panel"><span><BarChart3 size={17} />Peak</span><strong>{stressScore === null ? "--" : sessionPeak}</strong><small>/100</small></article><article className="stat-card panel"><span><Moon size={17} />Steady time</span><strong>{stressScore === null ? "--" : steadyRatio}</strong><small>%</small></article><article className="stat-card panel"><span><Leaf size={17} />Resets</span><strong>{interventionCount}</strong><small>used</small></article></div>
        </div>
      </section>

      <section className="science-note section-wrap"><div className="science-icon"><Brain size={25} /></div><div><strong>Measurement scope and limitations</strong><p>Face landmarks, vocal pitch, intensity, speech rate, and lexical pressure cues can all be affected by lighting, camera angle, microphone quality, accent, language, disability, culture, medication, and individual communication style. This prototype estimates observable changes relative to a short baseline; it cannot infer mental health, deception, competence, or intent.</p></div></section>
      <footer><span className="brand small">CallCoach <strong>Live</strong></span><p>Private by design · Multimodal by default · Built for mindful work</p><button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to top</button></footer>

      {interventionOpen && <div className="intervention-overlay" role="dialog" aria-modal="true" aria-label="Nature reset session"><NatureScene kind={selectedEnvironment} /><div className="intervention-shade" /><header className="intervention-header"><div><Leaf size={19} /><span><strong>CallCoach</strong> · {environments[selectedEnvironment].label}</span></div><div className="intervention-time"><span>TIME LEFT</span><strong>{remaining}</strong></div><button onClick={closeIntervention} aria-label="End reset"><X size={20} /></button></header><div className="breathing-center"><div className={`breath-orb ${breathPhase === "Inhale" ? "inhale" : breathPhase === "Hold" ? "hold" : "exhale"}`}><span><small>NOW</small><strong>{breathPhase}</strong></span></div><p>{environments[selectedEnvironment].breathing}</p></div><div className="intervention-controls"><div className="environment-switcher">{(Object.keys(environments) as EnvironmentKey[]).map((kind) => { const Icon = environments[kind].icon; return <button key={kind} className={kind === selectedEnvironment ? "active" : ""} onClick={() => selectEnvironment(kind)}><Icon size={17} />{environments[kind].short}</button>; })}</div><button className="play-button" onClick={() => interventionPlaying ? stopSoundscape() : void startSoundscape(selectedEnvironment)} aria-label={interventionPlaying ? "Pause sound" : "Play sound"}>{interventionPlaying ? <Pause size={23} /> : <Play size={23} />}</button><div className="overlay-volume">{volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}<input type="range" min="0" max="100" value={volume} style={{ "--range": `${volume}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Reset sound volume" /></div><button className="reset-button" onClick={() => setInterventionSeconds(300)}><RotateCcw size={16} />Reset to 5 minutes</button></div><p className="intervention-hint">Close your eyes if that feels comfortable. You can end the reset at any time.</p></div>}
    </main>
  );
}
