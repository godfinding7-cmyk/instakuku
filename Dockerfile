FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv python3-pip ca-certificates \
    && python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default,curl-cffi]" \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/ytdlp/bin:$PATH"
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["npm","start"]
