---
name: use-image2
description: Route every raster image generation or editing request through the plugin's GPT Image 2 MCP tools. Use whenever the user asks to generate, create, draw, render, illustrate, design, edit, modify, retouch, transform, restyle, inpaint, or otherwise produce a bitmap image, including image variants and reference-image workflows. While this plugin is active, prefer its Image2 tools over Codex's built-in image generation tool.
---

# Use Image2

Route image work through the `image2` MCP server bundled with this plugin.

## Workflow

1. For a new image, call `generate_image2` with the user's prompt and requested output options.
2. For an edit or reference-image request, call `edit_image2` with every available local source-image path and the edit prompt.
3. Return the image content from the tool directly to the user. State the selected model and options only when useful.
4. Let the MCP server try the primary endpoint twice. If both attempts fail, it automatically tries the fallback endpoint twice.
5. If either API key or endpoint environment variable is missing, report that configuration error. Both providers require their own `IMAGE2_API_KEY` / `IMAGE2_BASE_URL` and `IMAGE2_FALLBACK_API_KEY` / `IMAGE2_FALLBACK_BASE_URL`. Tell the user to configure these outside the repository and restart Codex.
6. If both upstreams reject `gpt-image-2` as an unknown model, ask the user for the relay's exact model ID or use the configured model overrides.

## Routing rules

- Do not call Codex's built-in `imagegen` or `image_gen` tool for raster image creation or editing while this plugin is active.
- Do not silently fall back to the built-in generator after an Image2 error. Explain the upstream or configuration error instead, unless the user explicitly requests a fallback.
- Treat the plugin's configured secondary Image2 endpoint as an approved automatic failover, not as a fallback to Codex's built-in generator.
- Preserve the user's prompt faithfully. Add detail only when it clarifies composition, lighting, materials, typography, camera, or style without changing intent.
- Use `quality: "low"` for drafts and `quality: "high"` for final assets when the user signals that distinction; otherwise use `auto`.
- Use `size: "auto"` unless the user supplies dimensions or an aspect requirement. GPT Image 2 dimensions must be multiples of 16, no edge above 3840 px, a maximum 3:1 ratio, and 655,360-8,294,400 total pixels.
- GPT Image 2 does not support transparent backgrounds. Use `background: "opaque"` or `"auto"`.
- For edits, pass multiple sources in their intended importance order and include a mask only when the user provides one.

## Security

- Never place API keys in prompts, tool arguments, generated files, error messages, or source control. The MCP server reads `IMAGE2_API_KEY` and `IMAGE2_FALLBACK_API_KEY` only from its process environment.
