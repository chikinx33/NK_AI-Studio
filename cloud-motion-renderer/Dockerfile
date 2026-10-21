# 인포그래픽 영상 클라우드 렌더러(Cloud Run Jobs nk-motion-render). deploy.sh 가 필요한 파일만 모아 Cloud Build 로 굽는다.
# 크롬(구글 공식 저장소) + ffmpeg(데비안: tmix·loudnorm·libx264 포함) + 모션 키트 + 렌더 스크립트.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg ffmpeg fonts-noto-cjk fonts-noto-color-emoji \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && apt-get purge -y curl gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# 컨테이너는 root 로 돌고 /dev/shm 이 작다. GPU 가 없다:
# 화면 합성은 --disable-gpu(소프트웨어 합성)가 SwiftShader GL 흉내보다 3.6배 빠르다(2026-10-22 실측). WebGL(gl-transitions)만 SwiftShader.
# 합성은 크롬 프로세스 하나가 혼자 해서, 일꾼마다 크롬을 따로 띄운다(MOTION_BROWSERS).
ENV MOTION_CHROME=/usr/bin/google-chrome-stable \
    MOTION_FFMPEG=/usr/bin/ffmpeg \
    MOTION_CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-gpu --enable-unsafe-swiftshader" \
    MOTION_WORKERS=6 \
    MOTION_BROWSERS=3

WORKDIR /app
COPY ai-company-app /app/ai-company-app
CMD ["node", "/app/ai-company-app/scripts/motion-cloud-job.mjs"]
