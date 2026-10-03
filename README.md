# Jannu - My AI Voice Assistant

A browser-based personal voice assistant using FastAPI, Groq Whisper, Llama, Edge-TTS, web search, and vision.

## Features

- Natural Tanglish voice responses
- Automatic listen -> understand -> reply -> speak -> listen loop
- Groq Whisper speech recognition
- Llama tool calling
- Live web search
- Vision image analysis
- PWA-ready frontend
- Optional Twilio webhook

## Run locally

Python 3.10+ is recommended.

```bash
python -m venv .venv
# Windows
.venv\\Scripts\\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
```

Set `GROQ_API_KEY` and run:

```bash
uvicorn app:app --reload
```

Open http://localhost:8000 in Chrome or Edge and allow microphone access.

## Environment variables

- GROQ_API_KEY - required
- GROQ_TEXT_MODEL - optional
- GROQ_WHISPER_MODEL - optional
- GROQ_VISION_MODEL - optional
- TTS_VOICE - optional

Calendar, smart-home, and WhatsApp are demo integrations until real service APIs are connected. Never commit API keys or .env files.
