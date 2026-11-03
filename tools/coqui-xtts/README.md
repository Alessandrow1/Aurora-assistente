# Aurora — Coqui XTTS-v2 experimental voice test

This optional experiment adds Coqui XTTS-v2 as a **manual comparison engine**. It does not replace Microsoft Edge Neural TTS or Kokoro and is never selected for normal conversation.

## License warning

The XTTS-v2 model weights are distributed under the Coqui Public Model License (CPML), which permits non-commercial use only. Read the terms at https://coqui.ai/cpml.txt before installing. The PowerShell installer asks for an explicit `ACEITO` confirmation and records that acceptance locally; the model download happens only when the user presses the test button in Aurora.

Do not use XTTS-v2 or its generated audio for paid work, monetized services, or other revenue-generating activity under this license.

## Install on Windows

From the repository root, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-coqui-xtts.ps1
```

The installer expects Python 3.11 x64 with the `py` launcher. It creates an isolated virtual environment under:

`%LOCALAPPDATA%\Aurora\coqui-xtts\venv`

It installs CPU-only PyTorch 2.8.0 / torchaudio 2.8.0 and `coqui-tts==0.28.0`. It does not install CUDA or use the GT 1030.

Close and reopen Aurora after the installer completes. Open Settings and use **Testar voz Coqui XTTS**. The first test downloads XTTS-v2 model files and loads them into RAM; subsequent tests reuse the same Python worker and loaded model while Aurora stays open.

## Experimental behavior

- CPU-only, with six Torch threads by default.
- Portuguese language code: `pt`.
- Built-in demo voice: `Ana Florence`.
- The test displays model-load and speech-synthesis timings.
- Audio is generated as WAV and played through the existing Aurora audio/avatar pipeline.
- The Python worker is separate from Electron and is stopped when Aurora exits.
- The current test uses a built-in demo speaker; it does not clone the Aurora/Thalita voice. A future step can add a local reference recording, with the speaker's permission.

To adjust the CPU thread count for the current Windows user, set `AURORA_COQUI_THREADS` before launching Aurora, for example `6` or `8`.

## Architecture

Electron talks to `electron/aurora-coqui-tts.cjs`, which keeps one Python worker alive and exchanges JSON Lines over stdin/stdout. The worker implementation is `worker.py`. The regular Edge TTS and Kokoro implementations remain unchanged.
