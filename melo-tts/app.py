"""NK Studio · MeloTTS 자체 호스팅 TTS 서버 (Cloud Run)

무료(오픈소스·MIT) 한국어 TTS. Gemini 같은 호출당 과금 없이,
Cloud Run 컴퓨트 시간만 든다. 브라우저 speechSynthesis와 달리 모든
사용자에게 동일한 목소리를 준다.

엔드포인트
  GET  /            헬스체크
  GET  /health      헬스체크(별칭)
  POST /tts         { text, speed?, semitones?, language? } -> audio/wav

보안: x-nk-proxy-secret 헤더가 환경변수 MELO_TTS_SECRET 과 일치해야 한다.
(openai-proxy 와 동일한 공유 시크릿 방식. 호출은 Cloudflare Function 이 서버측에서 한다.)
"""
import io
import os
import threading

from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel

app = FastAPI(title="nk-melo-tts")

LANGUAGE = os.environ.get("MELO_LANGUAGE", "KR")
DEVICE = os.environ.get("MELO_DEVICE", "cpu")
SECRET = os.environ.get("MELO_TTS_SECRET", "")
MAX_CHARS = int(os.environ.get("MELO_MAX_CHARS", "1600"))

# 모델은 무겁고 스레드 안전하지 않을 수 있어, 최초 1회 로드 후 락으로 직렬화한다.
_model = None
_spk_id = None
_model_lock = threading.Lock()
_load_lock = threading.Lock()


def _get_model():
    global _model, _spk_id
    if _model is not None:
        return _model, _spk_id
    with _load_lock:
        if _model is None:
            from melo.api import TTS  # 무거운 import 는 최초 로드 때만
            m = TTS(language=LANGUAGE, device=DEVICE)
            # spk2id 는 MeloTTS 의 HParams 객체(.get 없음). 대괄호/values 로 접근.
            spk = m.hps.data.spk2id
            if LANGUAGE in spk:
                _spk_id = spk[LANGUAGE]
            else:
                _spk_id = list(spk.values())[0]
            _model = m
    return _model, _spk_id


class TtsRequest(BaseModel):
    text: str
    speed: float = 1.0
    semitones: float = 0.0   # 피치 시프트(반음). 직원별 목소리 구분용.
    language: str | None = None


@app.get("/")
def root():
    return {"ok": True, "service": "nk-melo-tts", "language": LANGUAGE, "loaded": _model is not None}


@app.get("/health")
def health():
    return {"ok": True}


def _synth_wav(text: str, speed: float):
    """MeloTTS 로 오디오 생성. (numpy audio, sample_rate) 반환.
    output_path=None 이면 파일 없이 오디오 배열을 바로 돌려준다."""
    model, spk = _get_model()
    with _model_lock:
        audio = model.tts_to_file(
            text, spk, output_path=None,
            speed=max(0.5, min(2.0, speed)), quiet=True,
        )
    sr = int(model.hps.data.sampling_rate)
    return audio, sr


def _pitch_shift(data, sr: int, semitones: float):
    """반음 단위 피치 시프트(템포 유지). 0 이거나 실패하면 원본 그대로(비치명적)."""
    if not semitones:
        return data
    try:
        import numpy as np
        import librosa
        y = data if isinstance(data, np.ndarray) else np.asarray(data)
        if y.ndim > 1:
            y = y.mean(axis=1)  # 모노로
        return librosa.effects.pitch_shift(y.astype("float32"), sr=sr, n_steps=float(semitones))
    except Exception:
        # 피치 처리 실패는 치명적이지 않음 — 원본 음성이라도 반환한다.
        return data


@app.post("/tts")
def tts(req: TtsRequest, x_nk_proxy_secret: str = Header(default="")):
    if SECRET and x_nk_proxy_secret != SECRET:
        raise HTTPException(status_code=401, detail="bad_secret")
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS]
    try:
        import numpy as np
        import soundfile as sf
        data, sr = _synth_wav(text, req.speed)
        shifted = _pitch_shift(data, sr, req.semitones)
        buf = io.BytesIO()
        sf.write(buf, np.asarray(shifted), sr, format="WAV", subtype="PCM_16")
        wav = buf.getvalue()
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"tts_failed: {e}") from e
    return Response(content=wav, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
