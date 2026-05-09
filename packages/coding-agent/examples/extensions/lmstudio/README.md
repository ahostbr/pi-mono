# LM Studio Provider Extension

Registers an `lmstudio` provider backed by LM Studio's OpenAI-compatible Chat Completions endpoint. Models are discovered dynamically from the running LM Studio instance.

## Usage

```bash
pi -e ./packages/coding-agent/examples/extensions/lmstudio
```

Or from inside Pi:

```text
/load-ext lmstudio
```

Then select a model:

```text
/model lmstudio/<model-id>
```

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `LMSTUDIO_BASE_URL` | LM Studio OpenAI-compatible base URL | `http://localhost:1234/v1` |
| `LM_STUDIO_URL` | Alternate base URL variable | `http://localhost:1234/v1` |
| `LM_STUDIO_BASE_URL` | Alternate base URL variable | `http://localhost:1234/v1` |
| `LMSTUDIO_API_KEY` | Optional API key. LM Studio usually ignores this. | `lm-studio` |
| `LM_STUDIO_API_KEY` | Alternate API key variable | `lm-studio` |
| `LMS_CLI` | Path to the `lms` CLI | `%USERPROFILE%\.lmstudio\bin\lms.exe` on Windows, otherwise `lms` |

## Commands

```text
/lmstudio status          Show models, GPU, and connection info
/lmstudio refresh         Re-fetch models from LM Studio and update the provider
/lmstudio load <id>       Load a model by its LM Studio model ID
/lmstudio unload <id>     Unload a model (or --all to unload everything)
```

## Model Discovery

Models are fetched dynamically on startup and on `/lmstudio refresh`:

1. **v0 API** (`/api/v0/models`) — provides display name, quantization, context length, VLM detection, load state
2. **OpenAI API** (`/v1/models`) — fallback when v0 is unavailable

No hardcoded model list. Whatever LM Studio reports is what Pi sees.
