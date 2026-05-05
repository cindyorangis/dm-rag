FROM python:3.11-slim

# Install system dependencies (needed for many audio/math libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install pip requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt huggingface_hub

# 2. Download model files
# Using environment variables makes the RUN command cleaner
RUN python3 -c "from huggingface_hub import hf_hub_download; \
    hf_hub_download(repo_id='hexgrad/Kokoro-82M', filename='kokoro-v1.0.onnx', local_dir='.'); \
    hf_hub_download(repo_id='hexgrad/Kokoro-82M', filename='voices-v1.0.bin', local_dir='.')"

# 3. Copy application code
COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]