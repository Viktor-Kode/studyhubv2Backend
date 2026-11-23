# 🎙️ Study Map Node "Read Out Loud" (Audio Tutor) Integration Guide

> **Audience:** Frontend Developers (React, Next.js, React Native, Mobile PWA)  
> **Backend Base URL:** `/api/study-paths` (or `/api/generate-path`)  
> **Cost to System:** **$0.00 / Free Unlimited** (powered by Microsoft Edge Neural AI Speech with automatic server-side `.mp3` disk caching).

---

## 1. Overview & User Experience

When a student clicks the **"Read Out Loud"** (or **"Listen to Note"**) button inside any Study Map node:
1. The frontend plays an audio stream directly from the backend endpoint.
2. The backend generates a natural, human-grade voice reading the node's notes (Introduction $\to$ Analogy $\to$ Core Paragraphs $\to$ Memory Tip).
3. **Subsequent plays load in < 5ms**: Once a node's audio is synthesized once, it is permanently saved as an `.mp3` on the server disk.
4. **Standard Audio**: Works natively on **iOS Safari, Android Chrome, Desktop, and mobile apps** using the standard HTML5 `<audio>` element or Howler.js/Expo Audio.

---

## 2. API Endpoints

### 1) Stream / Play Node Audio
Streams the high-quality MP3 audio of the node lesson. Supports HTTP Range requests (`206 Partial Content`) so users can scrub backwards/forwards seamlessly.

```http
GET /api/study-paths/:topicId/node/:nodeId/audio
```

#### Query Parameters (All Optional):

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `voice` | `string` | `en-NG-EzinneNeural` | Voice persona. Available options below. |
| `speed` | `string` | `+0%` | Voice speed. e.g. `-10%`, `+0%`, `+20%`, `+50%`. |
| `pitch` | `string` | `+0Hz` | Voice pitch adjustment. |

#### Available Neural Voices:
- **`en-NG-EzinneNeural`** *(Default)*: Warm, articulate Nigerian English female tutor.
- **`en-NG-AbeoNeural`**: Friendly, clear Nigerian English male tutor.
- **`en-US-JennyNeural`**: Natural, high-clarity US English female educational host.
- **`en-US-GuyNeural`**: Deep, conversational US English male narrator.
- **`en-GB-SoniaNeural`**: Formal, crisp British English female voice.

#### Headers:
- `Authorization: Bearer <token>` *(Optional - guest/public study maps can also stream audio without auth).*

#### Response:
- **Content-Type**: `audio/mpeg`
- **Accept-Ranges**: `bytes`
- **Cache-Control**: `public, max-age=604800, immutable`

---

### 2) Get Spoken Script & Paragraph Markers (For Karaoke Highlighting)
Returns the exact spoken script broken down into paragraphs so the frontend can highlight the paragraph being read in real time!

```http
GET /api/study-paths/:topicId/node/:nodeId/audio-script
```

#### Response Example:
```json
{
  "success": true,
  "nodeId": 3,
  "title": "Photosynthesis: Light-Dependent Reactions",
  "estimatedDurationSeconds": 48,
  "sections": [
    {
      "type": "intro",
      "text": "Welcome to Photosynthesis: Light-Dependent Reactions."
    },
    {
      "type": "analogy",
      "label": "Think of it like this",
      "text": "Imagine chloroplasts as solar panels on a roof, capturing sunlight to recharge the plant's rechargeable batteries."
    },
    {
      "type": "paragraph",
      "index": 0,
      "text": "In the light reactions, chlorophyll pigments within the thylakoid membranes absorb photon energy..."
    },
    {
      "type": "memoryTip",
      "label": "Memory Tip",
      "text": "Remember: Light charges the battery, Calvin spends the money."
    }
  ]
}
```

---

## 3. Frontend Implementation Example (React / Next.js)

Here is a ready-to-drop React component using a clean floating Audio Player widget:

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, Loader2 } from 'lucide-react';

interface NodeAudioPlayerProps {
  topicId: string;
  nodeId: number;
  apiBaseUrl?: string; // defaults to your API url
}

export const NodeAudioPlayer: React.FC<NodeAudioPlayerProps> = ({
  topicId,
  nodeId,
  apiBaseUrl = 'https://api.studyhelp.com/api/study-paths'
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [selectedVoice, setSelectedVoice] = useState('en-NG-EzinneNeural');

  const audioSrc = `${apiBaseUrl}/${topicId}/node/${nodeId}/audio?voice=${selectedVoice}`;

  // Reset audio state if node changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, [nodeId, selectedVoice]);

  const togglePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsLoading(true);
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error('Audio playback error:', err);
          setIsLoading(false);
        });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const changeSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 0.85];
    const nextSpeed = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 text-white px-4 py-2.5 rounded-2xl shadow-lg my-3 w-full max-w-lg">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="none"
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setIsPlaying(true);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={handleTimeUpdate}
      />

      {/* Play / Pause / Loading button */}
      <button
        onClick={togglePlayPause}
        disabled={isLoading}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold transition-all disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-black" />
        ) : isPlaying ? (
          <Pause className="w-5 h-5" />
        ) : (
          <Play className="w-5 h-5 ml-0.5" />
        )}
      </button>

      {/* Progress & Time */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex justify-between text-xs text-neutral-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
      </div>

      {/* Speed pill */}
      <button
        onClick={changeSpeed}
        className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium"
      >
        {playbackSpeed}x
      </button>

      {/* Voice Toggle Dropdown */}
      <select
        value={selectedVoice}
        onChange={(e) => setSelectedVoice(e.target.value)}
        className="bg-neutral-800 text-xs text-neutral-300 rounded px-2 py-1 outline-none border border-neutral-700"
      >
        <option value="en-NG-EzinneNeural">🇳🇬 Ezinne (Female)</option>
        <option value="en-NG-AbeoNeural">🇳🇬 Abeo (Male)</option>
        <option value="en-US-JennyNeural">🇺🇸 Jenny (US)</option>
        <option value="en-US-GuyNeural">🇺🇸 Guy (US)</option>
        <option value="en-GB-SoniaNeural">🇬🇧 Sonia (UK)</option>
      </select>
    </div>
  );
};
```

---

## 4. How the Backend Cleans & Synthesizes the Text

When the student requests audio, the backend automatically performs the following transforms before synthesizing:
1. **Markdown & LaTeX Stripping**:
   - `**bold**` $\to$ `bold`
   - `*bullets*` $\to$ smooth spoken pauses.
   - LaTeX equations like `$H_2O$` $\to$ *"H two O"*, `$E=mc^2$` $\to$ *"E equals m c squared"*.
2. **Audio Structure**:
   - **Greeting**: *"Lesson: [Node Title]"*
   - **Analogy**: *"To understand this simply: [Analogy text]"*
   - **Notes**: *"[Paragraph 1] ... [Paragraph 2] ... "*
   - **Memory Tip**: *"Quick memory tip: [Memory Tip text]"*
3. **Pacing / SSML**: Small pauses between paragraphs so the voice breathes naturally like a tutor sitting next to the student.

---

## 5. Offline Fallback for Poor Connections (Optional)

If the student is on an airplane or has zero internet connectivity, the frontend can easily fall back to the browser-native `window.speechSynthesis`:

```javascript
export function speakOfflineFallback(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  window.speechSynthesis.speak(utterance);
}
```

---

## 6. Verification Checklist for Frontend Devs

- [ ] Click "Read Note" $\rightarrow$ audio begins playing within 1-2 seconds on first attempt, and < 100ms on subsequent attempts.
- [ ] Scrubbing slider works (scrubbing to 0:30 jumps cleanly without re-fetching from zero).
- [ ] Switching between Nigerian Female (`en-NG-EzinneNeural`) and US Voice updates the audio seamlessly.
- [ ] Changing tabs or locking phone keeps audio playing in background (standard HTML5 `<audio>` behavior).
