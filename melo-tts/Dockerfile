# NK Studio · MeloTTS(한국어) 자체 호스팅 TTS — Cloud Run 용
# CPU 전용. GPU 불필요.
FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface \
    MELO_LANGUAGE=KR \
    MELO_DEVICE=cpu

# 시스템 의존성: 빌드 도구, git(MeloTTS git 설치), libsndfile(soundfile), ffmpeg(librosa 백업)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git curl libsndfile1 ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU 전용 torch 를 먼저 설치(용량·시간 절약)
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.2.2

# 서버/오디오 의존성
COPY requirements.txt .
RUN pip install -r requirements.txt

# MeloTTS 본체(오픈소스, MIT) + 한국어 처리 사전
RUN pip install git+https://github.com/myshell-ai/MeloTTS.git \
 && python -m unidic download || true

# 앱 코드
COPY app.py .

# 빌드 시 한국어 모델 가중치를 이미지에 미리 캐시(콜드스타트 단축).
# 네트워크 이슈로 실패해도 런타임 첫 요청 때 내려받도록 빌드는 계속 진행.
RUN python -c "from melo.api import TTS; TTS(language='KR', device='cpu'); print('KR model cached')" || echo "warm-up skipped"

ENV PORT=8080
EXPOSE 8080

# Cloud Run 은 단일 컨테이너·저동시성 권장(모델 락 때문). uvicorn 워커 1.
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
