# 🎙️ AI Voice Integration (Local TTS)

This document outlines the architecture, setup, and implementation of the local Text-to-Speech (TTS) feature for **The Dungeon Master**[cite: 1, 2].

## 🏗️ Architecture Overview

The voice feature is designed to run efficiently on an **8GB RAM** machine by separating the heavy LLM inference from the audio synthesis[cite: 1, 2]. It operates as a sidecar microservice:

- **Frontend (Next.js):** Provides the UI for manual narration triggers[cite: 1, 2].
- **API Bridge (Next.js Route):** Cleans the LLM response of technical tags and proxies requests to the local Python server[cite: 1, 2].
- **TTS Engine (FastAPI):** A Python-based server running the **Kokoro-82M** model via ONNX for near-instant audio generation[cite: 1, 2].

## 🛠️ Setup Instructions

### 1. Python Environment

Navigate to your `tts-server` directory and install the required dependencies[cite: 1, 2]:

```bash
cd tts-server
pip install fastapi uvicorn kokoro-onnx soundfile
```

### 2. Model Assets

Download these files and place them directly in the `/tts-server` folder[cite: 1, 2]:

- **Model:** `kokoro-v1.0.onnx`[cite: 1, 2]
- **Voices:** `voices-v1.0.bin`[cite: 1, 2]

### 3. Running the Server

Start the service using Uvicorn. The Next.js app expects this to be on port 8000[cite: 1, 2].

```bash
uvicorn main:app --reload --port 8000
```

---

## 📜 Implementation Details

### Narrative Cleaning Logic

The DM output contains structured tags (`[STATUS]`, `[HINTS]`, `[ROLL]`) that should not be spoken[cite: 1, 2]. The `getCleanNarrativeForSpeech` utility handles this[cite: 1, 2]:

```typescript
export const getCleanNarrativeForSpeech = (text: string): string => {
  return text
    .replace(/\[STATUS\][\s\S]*?\[\/STATUS\]/g, "")
    .replace(/\[HINTS\][\s\S]*?\[\/HINTS\]/g, "")
    .replace(/\[ROLL:.*?\]/g, "")
    .replace(/\*.*?\*/g, "") // Removes italics/actions
    .trim();
};
```

### Supported Voices

Pass the `voice` parameter in the request to change the narrator's persona[cite: 1, 2]:

| Voice ID   | Style         | Recommendation                  |
| :--------- | :------------ | :------------------------------ |
| `af_sky`   | Neutral       | Default Narrator[cite: 1, 2]    |
| `am_adam`  | Deep/Resonant | Classic DM Tone[cite: 1, 2]     |
| `am_onyx`  | Gritty/Dark   | Villains & Monsters[cite: 1, 2] |
| `af_bella` | Soft/Melodic  | Elves & Magic Users[cite: 1, 2] |

---

## 🚀 Performance Notes for 8GB RAM

- **Manual Trigger:** The "Play" button is manual to avoid CPU contention during LLM streaming[cite: 1, 2].
- **Resource Usage:** The Python server consumes ~300-500MB of RAM[cite: 1, 2].
- **Local Only:** Requires the Python backend running on the host machine[cite: 1, 2].
