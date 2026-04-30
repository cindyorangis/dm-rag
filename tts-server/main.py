from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from kokoro_onnx import Kokoro
import io
import soundfile as sf

app = FastAPI()

# Load model once at startup (~300MB RAM)
# Ensure kokoro-v1.0.onnx and voices-v1.0.bin are in this folder
kokoro = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")


@app.get("/generate")
async def generate_voice(text: str = Query(...), voice: str = "af_sky"):
    samples, sample_rate = kokoro.create(text, voice=voice, speed=1.0, lang="en-us")

    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV")
    buffer.seek(0)

    return StreamingResponse(buffer, media_type="audio/wav")
