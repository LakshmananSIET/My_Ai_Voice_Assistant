import os
import json
import base64
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from groq import Groq
import edge_tts
from duckduckgo_search import DDGS
from twilio.twiml.voice_response import VoiceResponse

app = FastAPI(title="Jannu - My AI Voice Assistant")
app.mount("/static", StaticFiles(directory="static"), name="static")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
TEXT_MODEL = os.environ.get("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile")
VISION_MODEL = os.environ.get("GROQ_VISION_MODEL", "llama-3.2-11b-vision-preview")
WHISPER_MODEL = os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")
TTS_VOICE = os.environ.get("TTS_VOICE", "en-US-AvaNeural")


def get_client() -> Groq:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY environment variable missing.")
    return Groq(api_key=GROQ_API_KEY)


def search_web(query: str) -> str:
    try:
        results = list(DDGS().text(query, max_results=3))
        if not results:
            return "No web search results found."
        return "\n".join(f"- {r.get('title', 'Result')}: {r.get('body', '')}" for r in results)
    except Exception as exc:
        return f"Search error: {exc}"


def get_calendar_events() -> str:
    return "No real calendar connection is configured yet."


def control_smart_home(device: str, state: str) -> str:
    return f"Smart-home demo: switched {state} the {device}."


def send_whatsapp_message(recipient: str, message: str) -> str:
    return f"WhatsApp demo: prepared a message for {recipient}: '{message}'."


TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the live internet for weather, news, facts, or real-time information.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_calendar_events",
            "description": "Fetch calendar events when a real calendar integration is available.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "control_smart_home",
            "description": "Control a smart-home device.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device": {"type": "string"},
                    "state": {"type": "string", "enum": ["on", "off"]},
                },
                "required": ["device", "state"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_whatsapp_message",
            "description": "Prepare/send a WhatsApp or text message.",
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {"type": "string"},
                    "message": {"type": "string"},
                },
                "required": ["recipient", "message"],
            },
        },
    },
]


def make_system_prompt() -> str:
    current_time = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%A, %B %d, %Y at %I:%M %p IST")
    return f"""
You are Jannu, a friendly personal voice assistant for Lakshmanan.
Current time: {current_time}.

Conversation style:
- Speak naturally and briefly.
- Use simple Tanglish (Tamil + English written in Latin script) unless the user clearly asks for another language.
- Do not translate every word mechanically.
- Sound like a friendly human assistant.
- For greetings, say: "Hi Lakshman sir! Enna help venum?"
- Usually answer in 1-3 short sentences because the answer will be spoken aloud.
- Use tools for live web information when needed.
""".strip()


def generate_ai_text(client: Groq, user_text: str) -> str:
    messages = [
        {"role": "system", "content": make_system_prompt()},
        {"role": "user", "content": user_text},
    ]

    response = client.chat.completions.create(
        model=TEXT_MODEL,
        messages=messages,
        tools=TOOLS_SCHEMA,
        tool_choice="auto",
    )
    response_msg = response.choices[0].message

    if not response_msg.tool_calls:
        return response_msg.content or "Sorry sir, konjam repeat pannunga."

    messages.append(response_msg)

    for tool_call in response_msg.tool_calls:
        func_name = tool_call.function.name
        args = json.loads(tool_call.function.arguments or "{}")

        if func_name == "search_web":
            tool_output = search_web(args.get("query", ""))
        elif func_name == "get_calendar_events":
            tool_output = get_calendar_events()
        elif func_name == "control_smart_home":
            tool_output = control_smart_home(args.get("device", ""), args.get("state", "off"))
        elif func_name == "send_whatsapp_message":
            tool_output = send_whatsapp_message(
                args.get("recipient", ""), args.get("message", "")
            )
        else:
            tool_output = "Tool output unavailable."

        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": tool_output,
            }
        )

    final_response = client.chat.completions.create(
        model=TEXT_MODEL,
        messages=messages,
    )
    return final_response.choices[0].message.content or "Sorry sir, answer generate panna mudiyala."


async def synthesize_speech(text: str) -> str:
    try:
        communicate = edge_tts.Communicate(text, voice=TTS_VOICE)
        audio_bytes = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_bytes += chunk["data"]
        return base64.b64encode(audio_bytes).decode("utf-8")
    except Exception:
        return ""


class ChatRequest(BaseModel):
    text: str


@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "assistant": "jannu"}


class ReminderRequest(BaseModel):
    text: str


@app.post("/api/reminder")
async def create_reminder(request: ReminderRequest):
    client = get_client()
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    prompt = f"""
You are a reminder parser. Current India time is {now.isoformat()}.
Parse the user's reminder request and return ONLY valid JSON with:
{{"title":"short reminder title","due_at":"ISO-8601 datetime with +05:30 offset"}}

Rules:
- Understand natural language such as "remind me at 6 PM to call Arun", "tomorrow 8 AM study Verilog", "in 20 minutes drink water".
- If the user gives a time without a date, use today if that time is still in the future; otherwise use tomorrow.
- If no usable future date/time can be determined, return {{"title":"","due_at":""}}.
- Keep the title short and natural.
User request: {request.text}
""".strip()

    try:
        result = client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "system", "content": prompt}],
            response_format={"type": "json_object"},
        )
        data = json.loads(result.choices[0].message.content or "{}")
        due_at = data.get("due_at", "")
        title = data.get("title", "").strip()
        if not due_at or not title:
            return {"ok": False, "message": "Reminder time puriyala sir. Example: 6 PM-ku call Arun remind pannu."}
        due = datetime.fromisoformat(due_at)
        if due.tzinfo is None:
            due = due.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
        due = due.astimezone(ZoneInfo("Asia/Kolkata"))
        if due <= now:
            return {"ok": False, "message": "Andha time past-la irukku sir. Future time sollunga."}
        message = f"Seri sir, {due.strftime('%d %b %I:%M %p')} ku remind panren: {title}."
        return {
            "ok": True,
            "title": title,
            "due_at": due.isoformat(),
            "message": message,
            "audio_b64": await synthesize_speech(message),
        }
    except Exception as exc:
        return {"ok": False, "message": f"Reminder set panna mudiyala sir: {exc}"}


@app.post("/api/chat")
async def chat(request: ChatRequest):
    client = get_client()
    user_text = request.text.strip()
    if not user_text:
        return JSONResponse(
            {"transcription": "", "response_text": "Sorry sir, kekkala.", "audio_b64": ""}
        )

    try:
        ai_text = generate_ai_text(client, user_text)
    except Exception:
        ai_text = "Sorry sir, ippo response generate panna mudiyala."

    return {
        "transcription": user_text,
        "response_text": ai_text,
        "audio_b64": await synthesize_speech(ai_text),
    }


@app.post("/api/voice")
async def process_voice(file: UploadFile = File(...)):
    client = get_client()
    audio_bytes = await file.read()

    try:
        transcription = client.audio.transcriptions.create(
            file=("audio.webm", audio_bytes),
            model=WHISPER_MODEL,
        )
        user_text = (transcription.text or "").strip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Speech Recognition Error: {exc}")

    if not user_text:
        response_text = "Sorry sir, onnum kekkala. Again pesunga."
        return {
            "transcription": "",
            "response_text": response_text,
            "audio_b64": await synthesize_speech(response_text),
        }

    try:
        ai_text = generate_ai_text(client, user_text)
    except Exception:
        ai_text = "Sorry sir, ippo response generate panna mudiyala."

    return {
        "transcription": user_text,
        "response_text": ai_text,
        "audio_b64": await synthesize_speech(ai_text),
    }


@app.post("/api/vision")
async def process_vision(
    file: UploadFile = File(...),
    prompt: str = Form("Describe what you see in this image briefly."),
):
    client = get_client()
    image_bytes = await file.read()
    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    try:
        completion = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64_image}"},
                        },
                    ],
                }
            ],
        )
        description = completion.choices[0].message.content or "Image puriyala."
    except Exception as exc:
        description = f"Image process panna mudiyala: {exc}"

    return {
        "description": description,
        "audio_b64": await synthesize_speech(description),
    }


@app.post("/api/twilio/voice")
async def twilio_voice_handler(request: Request):
    response = VoiceResponse()
    response.say(
        "Hello! I am Jannu. Please leave your message after the beep.",
        voice="Polly.Joanna",
    )
    return Response(content=str(response), media_type="application/xml")
