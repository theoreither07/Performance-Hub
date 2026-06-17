FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sync.py loop.sh ./
RUN chmod +x /app/loop.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/app/loop.sh"]
