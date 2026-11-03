#!/usr/bin/env python
"""Persistent JSONL worker for the optional Coqui XTTS-v2 experiment.

The worker runs on CPU and loads the XTTS-v2 model only after the first test.
It never changes Aurora's default Edge/Kokoro speech providers.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import sys
import tempfile
import time
import wave

PROTOCOL_OUT = sys.stdout
MODEL = None
MODEL_LOAD_MS = None


def send(payload: dict) -> None:
    PROTOCOL_OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def load_model():
    global MODEL, MODEL_LOAD_MS
    if MODEL is not None:
        return MODEL

    started = time.perf_counter()
    send({"type": "status", "state": "loading", "message": "Carregando XTTS-v2 pela primeira vez; os pesos serão baixados se necessário."})
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from TTS.api import TTS

        thread_count = max(2, min(8, int(os.environ.get("AURORA_COQUI_THREADS", "6"))))
        torch.set_num_threads(thread_count)
        try:
            torch.set_num_interop_threads(2)
        except RuntimeError:
            pass
        MODEL = TTS(
            model_name="tts_models/multilingual/multi-dataset/xtts_v2",
            progress_bar=False,
        ).to("cpu")

    MODEL_LOAD_MS = round((time.perf_counter() - started) * 1000)
    send({
        "type": "status",
        "state": "model-loaded",
        "message": "XTTS-v2 carregado na CPU e pronto para testes.",
        "modelLoadMs": MODEL_LOAD_MS,
    })
    return MODEL


def synthesize(request: dict) -> dict:
    text = str(request.get("text") or "").strip()
    if not text:
        raise ValueError("O texto para síntese está vazio.")
    if len(text) > 1800:
        raise ValueError("O texto excede o limite de 1.800 caracteres deste teste.")

    speaker = str(request.get("speaker") or "Ana Florence").strip()[:80]
    language = str(request.get("language") or "pt")
    if language != "pt":
        raise ValueError("Este teste está configurado para português.")

    model = load_model()
    started = time.perf_counter()
    descriptor, output_path = tempfile.mkstemp(prefix="aurora-coqui-", suffix=".wav")
    os.close(descriptor)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            model.tts_to_file(
                text=text,
                file_path=output_path,
                speaker=speaker,
                language=language,
                split_sentences=True,
            )
        with open(output_path, "rb") as audio_file:
            audio_bytes = audio_file.read()
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            duration_seconds = wav_file.getnframes() / max(1, sample_rate)
        if len(audio_bytes) < 100:
            raise RuntimeError("XTTS-v2 retornou um WAV vazio ou incompleto.")

        return {
            "id": request.get("id"),
            "ok": True,
            "speaker": speaker,
            "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
            "performance": {
                "modelLoadMs": MODEL_LOAD_MS,
                "synthesisMs": round((time.perf_counter() - started) * 1000),
                "audioSeconds": round(duration_seconds, 2),
                "sampleRate": sample_rate,
                "audioBytes": len(audio_bytes),
                "device": "cpu",
            },
        }
    finally:
        try:
            os.remove(output_path)
        except OSError:
            pass


def main() -> None:
    send({"type": "status", "state": "ready", "message": "Worker Python do Coqui iniciado; o modelo será carregado no primeiro teste."})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = {}
        try:
            request = json.loads(line)
            if request.get("action") != "synthesize":
                raise ValueError("Ação não suportada pelo worker Coqui.")
            response = synthesize(request)
        except Exception as error:  # keep the worker alive for the next test
            response = {
                "id": request.get("id"),
                "ok": False,
                "error": str(error)[:1200],
            }
        send(response)


if __name__ == "__main__":
    main()
