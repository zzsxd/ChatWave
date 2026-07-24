FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt alembic.ini /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    groupadd --system chatwave && \
    useradd --system --gid chatwave --home-dir /app chatwave && \
    mkdir -p /app/data && \
    chown -R chatwave:chatwave /app
COPY --chown=chatwave:chatwave /src /app/src
ENV PYTHONPATH=/app/src
USER chatwave
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000"]
