#!/usr/bin/env python3
"""Configure an isolated Open-LLM-VTuber v1.2.1 test for Aurora."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--avatar-source", required=True, type=Path)
    parser.add_argument("--ollama-model", default="qwen3.5:9b")
    return parser.parse_args()


def validate_avatar(source: Path) -> dict[str, Any]:
    model_file = source / "6xb.model3.json"
    if not model_file.is_file():
        raise FileNotFoundError(f"Arquivo do modelo Live2D não encontrado: {model_file}")

    model = json.loads(model_file.read_text(encoding="utf-8"))
    references = model.get("FileReferences", {})
    required: list[str] = []
    for key in ("Moc", "Physics", "DisplayInfo"):
        value = references.get(key)
        if value:
            required.append(value)
    required.extend(references.get("Textures", []))

    for relative in required:
        candidate = (source / relative).resolve()
        if source.resolve() not in candidate.parents and candidate != source.resolve():
            raise ValueError(f"Referência Live2D fora da pasta do modelo: {relative}")
        if not candidate.is_file():
            raise FileNotFoundError(f"Arquivo exigido pelo 6xb.model3.json não encontrado: {candidate}")
    return model


def main() -> None:
    args = parse_args()
    project = args.project_root.resolve()
    avatar_source = args.avatar_source.resolve()

    if not project.is_dir():
        raise NotADirectoryError(f"Pasta do Open-LLM-VTuber não encontrada: {project}")
    if not avatar_source.is_dir():
        raise NotADirectoryError(f"Pasta do avatar Aurora não encontrada: {avatar_source}")

    config_path = project / "conf.yaml"
    model_dict_path = project / "model_dict.json"
    template_path = project / "config_templates" / "conf.default.yaml"
    if config_path.exists():
        raise FileExistsError(f"{config_path} já existe; não vou sobrescrever sua configuração.")
    if not model_dict_path.is_file():
        raise FileNotFoundError(f"Não encontrei o catálogo Live2D esperado: {model_dict_path}")
    if not template_path.is_file():
        raise FileNotFoundError(f"Modelo de configuração não encontrado: {template_path}")

    validate_avatar(avatar_source)

    model_name = "aurora-6xb"
    avatar_destination = project / "live2d-models" / model_name
    if avatar_destination.exists():
        raise FileExistsError(f"O destino do avatar já existe; não vou sobrescrever: {avatar_destination}")

    shutil.copytree(avatar_source, avatar_destination)

    try:
        model_dict = json.loads(model_dict_path.read_text(encoding="utf-8"))
        if not isinstance(model_dict, list):
            raise ValueError("O model_dict.json não contém uma lista.")
        if any(item.get("name") == model_name for item in model_dict if isinstance(item, dict)):
            raise ValueError(f"O modelo '{model_name}' já existe no catálogo Live2D.")
        model_dict.append(
            {
                "name": model_name,
                "description": "Aurora Live2D 6xb (teste isolado)",
                "url": f"/live2d-models/{model_name}/6xb.model3.json",
                "kScale": 0.5,
                "initialXshift": 0,
                "initialYshift": 0,
            }
        )
        model_dict_path.write_text(
            json.dumps(model_dict, ensure_ascii=False, indent=4) + "\n",
            encoding="utf-8",
        )

        yaml = YAML()
        yaml.preserve_quotes = True
        with template_path.open("r", encoding="utf-8") as handle:
            config = yaml.load(handle)

        character = config["character_config"]
        character["conf_name"] = "aurora"
        character["conf_uid"] = "aurora_local_001"
        character["live2d_model_name"] = model_name
        character["character_name"] = "Aurora"
        character["avatar"] = ""
        character["human_name"] = "Usuário"
        character["persona_prompt"] = (
            "Você é Aurora, uma companheira de inteligência artificial que conversa "
            "em português brasileiro. Fale de forma natural, concisa e espontânea, "
            "como numa conversa por voz. Seja espirituosa, brincalhona e levemente "
            "sarcástica quando combinar, sem ser cruel. Em assuntos sérios, seja "
            "acolhedora, calma e empática. Não finja executar ações que não realizou. "
            "Evite títulos, listas longas, excesso de emojis e respostas com cara de "
            "documentação quando estiver conversando por voz. Preserve o contexto "
            "da conversa e faça perguntas naturais quando faltar informação."
        )

        agent = character["agent_config"]["agent_settings"]["basic_memory_agent"]
        agent["llm_provider"] = "ollama_llm"
        agent["faster_first_response"] = True
        agent["segment_method"] = "regex"
        agent["use_mcpp"] = False
        agent["mcp_enabled_servers"] = []

        ollama = character["agent_config"]["llm_configs"]["ollama_llm"]
        ollama["base_url"] = "http://127.0.0.1:11434/v1"
        ollama["model"] = args.ollama_model
        ollama["temperature"] = 0.7
        ollama["keep_alive"] = -1
        ollama["unload_at_exit"] = False

        asr = character["asr_config"]
        asr["asr_model"] = "faster_whisper"
        whisper = asr["faster_whisper"]
        whisper["model_path"] = "base"
        whisper["download_root"] = "models/whisper"
        whisper["language"] = "pt"
        whisper["device"] = "cpu"
        whisper["compute_type"] = "int8"
        whisper["prompt"] = "Aurora, Live2D, Qwen, Ollama, sherpa-onnx, ElevenLabs, Kokoro."

        tts = character["tts_config"]
        tts["tts_model"] = "edge_tts"
        tts["edge_tts"]["voice"] = "pt-BR-LeticiaNeural"

        vad = character["vad_config"]
        vad["vad_model"] = "silero_vad"
        vad["silero_vad"]["orig_sr"] = 16000
        vad["silero_vad"]["target_sr"] = 16000
        vad["silero_vad"]["required_hits"] = 3
        vad["silero_vad"]["required_misses"] = 24

        with config_path.open("w", encoding="utf-8", newline="\n") as handle:
            yaml.dump(config, handle)
    except Exception:
        shutil.rmtree(avatar_destination, ignore_errors=True)
        raise

    print("Configuração criada para o teste isolado:")
    print(f"  Projeto: {project}")
    print(f"  Modelo: {args.ollama_model}")
    print(f"  Avatar copiado para: {avatar_destination}")
    print(f"  Configuração: {config_path}")
    print("  ASR: Faster-Whisper base / CPU int8 / português")
    print("  VAD: Silero")
    print("  TTS: Edge TTS pt-BR-LeticiaNeural")
    print("  Memória de longo prazo externa: não habilitada neste primeiro teste")


if __name__ == "__main__":
    main()
