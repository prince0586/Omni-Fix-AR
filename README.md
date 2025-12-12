# Omni-Fix AR 🛠️

**Omni-Fix** is an intelligent, AR-powered universal repair assistant powered by Google's **Gemini 3 Pro Preview**. It transforms your smartphone into an expert repair companion that can see, hear, and guide you through complex mechanical tasks.

## 🌟 Key Features

### 1. AR Repair Guide
Real-time augmented reality overlays (bounding boxes, arrows, points) guide you step-by-step through repairs.

### 2. 🧠 Spatial Component Inspector (New!)
**Tap anywhere** on the video feed to identify components. The app uses Gemini 3 Pro's spatial reasoning to tell you exactly what part you are pointing at, its function, and if it looks damaged.

### 3. 🔊 Sonic Assistant
A multimodal hands-free assistant. Hold the mic button to let the AI **listen** to your machine or ask questions. It responds with helpful voice guidance.

### 4. 🛡️ Intelligent Safety Guard
Automatically detects potential hazards (High Voltage, Sharp Edges, Heat) for every step and displays pulsing safety warnings.

## Tech Stack

- **Frontend**: React, Tailwind CSS, Lucide Icons
- **AI**: Google GenAI SDK (`gemini-3-pro-preview`)
- **APIs**: WebRTC (Camera/Mic), Web Speech API (TTS)

## Usage

1. **Scan**: Point the camera at a broken object.
2. **Follow**: Follow the AR instructions.
3. **Inspect**: Tap parts to learn more.
4. **Ask**: Use the mic for help.

**Testing app Link** : https://omni-fix-ar-932126588073.us-west1.run.app/
