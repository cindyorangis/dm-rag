FROM python:3.11-slim

# Install system dependencies (needed for many audio/math libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install pip requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2. Download model files
# Using environment variables makes the RUN command cleaner
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -L "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" -o /app/kokoro-v1.0.onnx && \
    curl -L "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" -o /app/voices-v1.0.bin

# 3. Copy application code
COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]