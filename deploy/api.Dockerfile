ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/api /app/services/api
COPY migrations /app/migrations
COPY third_party/openstitch /app/third_party/openstitch
ENV PYTHONPATH=/app/services/api PYTHONUNBUFFERED=1
EXPOSE 8011
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8011/api/health', timeout=4)"
CMD ["sh", "-c", "alembic -c migrations/alembic.ini upgrade head && exec uvicorn quark.main:app --host 0.0.0.0 --port 8011"]
