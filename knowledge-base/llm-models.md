# Available LLM Models

This document describes the LLM models available for building chatbots, AI agents, and other AI-powered applications.

---

## Gemini Models (Google)

### Text / Reasoning Models

| Model                           | Description                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `gemini-3.1-pro-preview`        | Latest Gemini 3.1 Pro preview — highest capability for complex reasoning and instruction following |
| `gemini-3-pro-preview`          | Gemini 3 Pro preview — strong general-purpose reasoning and generation                             |
| `gemini-2.5-pro`                | Stable Gemini 2.5 Pro — production-ready, high-quality text generation                             |
| `gemini-2.5-flash`              | Stable Gemini 2.5 Flash — fast, cost-efficient, good for most chat and agent tasks                 |
| `gemini-2.5-flash-lite`         | Gemini 2.5 Flash Lite — lightest and fastest 2.5 variant, ideal for low-latency or high-volume use |
| `gemini-3-flash-preview`        | Gemini 3 Flash preview — fast next-gen model for real-time interactions                            |
| `gemini-3.1-flash-lite-preview` | Gemini 3.1 Flash Lite preview — ultra-lightweight variant optimized for speed and efficiency       |

### Image Generation Models

| Model                            | Description                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `gemini-3.1-flash-image-preview` | Gemini 3.1 Flash with image generation capabilities — fast multimodal output     |
| `gemini-3-pro-image-preview`     | Gemini 3 Pro with image generation capabilities — high-quality multimodal output |

### Video Generation Models

| Model                           | Description                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `veo-3.1-generate-preview`      | Veo 3.1 — high-quality AI video generation from text or image prompts                |
| `veo-3.1-fast-generate-preview` | Veo 3.1 Fast — accelerated video generation for faster turnaround at reduced quality |

---

## Claude Models (Anthropic)

| Model                        | Description                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `claude-opus-4-6`            | Claude Opus 4.6 — most capable Claude model, best for complex multi-step reasoning and agentic tasks         |
| `claude-opus-4-5-20251101`   | Claude Opus 4.5 (Nov 2025) — highly capable, strong reasoning and instruction following                      |
| `claude-sonnet-4-6`          | Claude Sonnet 4.6 — balanced performance and speed, ideal for most production chatbot and agent use cases    |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 (Sep 2025) — cost-effective with strong general-purpose capability                         |
| `claude-haiku-4-5-20251001`  | Claude Haiku 4.5 (Oct 2025) — fastest and most lightweight Claude model, optimized for low-latency responses |

### Choosing a Claude Model

- **Agentic / complex workflows** → `claude-opus-4-6` or `claude-opus-4-5-20251101`
- **General chatbots / assistants** → `claude-sonnet-4-6` or `claude-sonnet-4-5-20250929`
- **Low-latency / high-volume** → `claude-haiku-4-5-20251001`

---

## OpenAI Models

| Model         | Description                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `gpt-5.2`     | GPT-5.2 — cutting-edge reasoning and generation, highest capability in the GPT-5 family          |
| `gpt-5.2-pro` | GPT-5.2 Pro — enhanced GPT-5.2 optimized for professional and complex use cases                  |
| `gpt-5`       | GPT-5 — flagship GPT-5 model with strong reasoning and instruction following                     |
| `gpt-5-mini`  | GPT-5 Mini — compact GPT-5 variant balancing capability and efficiency                           |
| `gpt-5-nano`  | GPT-5 Nano — ultra-lightweight GPT-5 model for latency-sensitive or cost-constrained deployments |
| `gpt-4.1`     | GPT-4.1 — proven production model, reliable and widely supported                                 |

### Choosing an OpenAI Model

- **Maximum capability** → `gpt-5.2-pro` or `gpt-5.2`
- **General production use** → `gpt-5` or `gpt-4.1`
- **Balanced cost/performance** → `gpt-5-mini`
- **High-volume / low-latency** → `gpt-5-nano`

---

## Model Selection Guide

| Use Case                     | Recommended Models                                                 |
| ---------------------------- | ------------------------------------------------------------------ |
| Complex agentic workflows    | `claude-opus-4-6`, `gpt-5.2-pro`, `gemini-3.1-pro-preview`         |
| General-purpose chatbots     | `claude-sonnet-4-6`, `gpt-5`, `gemini-2.5-pro`                     |
| Real-time / low-latency chat | `claude-haiku-4-5-20251001`, `gpt-5-nano`, `gemini-2.5-flash-lite` |
| Fast, cost-efficient agents  | `gemini-3-flash-preview`, `gpt-5-mini`, `gemini-2.5-flash`         |
| Image generation             | `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`     |
| Video generation             | `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`        |
