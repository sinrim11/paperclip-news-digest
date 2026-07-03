# Multi-stage build for news-digest FastAPI application
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for trafilatura (HTML parsing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create output directory for generated digests
RUN mkdir -p output

# Expose FastAPI web server port
EXPOSE 3200

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:3200/health')" || exit 1

# Run the FastAPI web server
# Note: For full pipeline execution with summarization, requires Ollama/MLX running separately
CMD ["python", "-m", "uvicorn", "web_app.main:app", "--host", "0.0.0.0", "--port", "3200"]
