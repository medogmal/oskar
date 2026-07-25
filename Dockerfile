FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860 \
    PYTHON_ANALYTICS_PORT=8001 \
    PYTHON_ANALYTICS_URL=http://127.0.0.1:8001 \
    PYTHON_ANALYTICS_TIMEOUT_MS=120000 \
    ENABLE_LOCAL_AUTH_FALLBACK=true \
    ENABLE_MOCK_LLM=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --no-audit --no-fund

COPY backend ./backend
RUN cd backend && npm run build

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --upgrade pip \
  && pip install -r backend/python_analytics/requirements.txt

COPY scripts/start-hf-space.sh ./scripts/start-hf-space.sh
RUN chmod +x ./scripts/start-hf-space.sh \
  && mkdir -p /app/backend/data /app/backend/uploads

EXPOSE 7860

CMD ["./scripts/start-hf-space.sh"]
