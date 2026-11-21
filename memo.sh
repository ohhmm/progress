#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT=--
MODEL="${OLLAMA_MODEL:-Beam-1.0-501B-A23B}"
CLAUDE_CODE_MAX_CONTEXT_TOKENS=1048576
ANTHROPIC_DEFAULT_OPUS_MODEL=$MODEL
API_TIMEOUT_MS=1800000
ANTHROPIC_BASE_URL=https://api.reflection.ai/openai/v1/messages
ANTHROPIC_AUTH_TOKEN=`cat "$HOME/.mirror/reflection_api_key"`
export CLAUDE_CODE_MAX_CONTEXT_TOKENS ANTHROPIC_DEFAULT_OPUS_MODEL API_TIMEOUT_MS ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN


if [ "$#" -ne 0 ]; then
   INPUT="-- $@"
fi

cd "$SCRIPT_DIR" &&
   exec ./caffeinate.sh  claude --model "$MODEL" $INPUT
