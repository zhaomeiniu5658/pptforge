FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/api /app/services/api
COPY migrations /app/migrations
COPY third_party/openstitch /app/third_party/openstitch
ENV PYTHONPATH=/app/services/api PYTHONUNBUFFERED=1
