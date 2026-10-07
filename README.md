# Image2 ImageGen for Codex

> 我做这个插件，是因为直接让 Codex 画图会调用内置的 `imagegen`，使用 `image1.5` 生成图片，无法直接使用 `image2`；因此，采用“插件 + MCP”的方式接入 `image2` 生图。

一个通过自定义 MCP 工具调用 OpenAI 兼容图片接口的 Codex 插件。支持图片生成、使用本地图片进行编辑，以及主站失败后的备用站切换。

基于 [MIT License](LICENSE) 开源。

本仓库不提供账号、API Key 或中转站地址。使用者需要配置自己的服务。

## 功能

- `generate_image2`：文本生图。
- `edit_image2`：本地图片编辑，可提供多张参考图和可选蒙版。
- 调用顺序：主站最多 2 次；全部失败后，备用站最多 2 次；成功即返回。
- 单次上游请求默认超时 300 秒，MCP 工具总超时为 1500 秒。
- 当前插件要求同时配置主站和备用站。重试可能产生额外费用；超时不代表服务端已停止处理。
- 插件通过技能引导 Codex 使用这些工具；它不会替换或拦截 Codex 内置图片工具的实现。

## 运行环境

需要 Node.js 20 或更新版本，并确保 Codex 启动时能找到 `node` 命令。

使用兼容的 `/v1/images/generations` 和 `/v1/images/edits` 接口。接口响应应包含 `data[].b64_json` 或 `data[].url`。

默认请求模型 ID 为 `gpt-image-2`。不同服务可能使用不同模型 ID；是否支持该模型、图片参数及尺寸，需要向所选服务确认。这不是官方 OpenAI 插件。

## 配置

所有配置均从进程环境读取；`.env.example` 仅提供占位符模板，服务器不会自动加载 `.env` 文件。

| 环境变量 | 用途 |
| --- | --- |
| `IMAGE2_BASE_URL` | 主站地址，必填，可带或不带末尾 `/v1` |
| `IMAGE2_API_KEY` | 主站 API Key，必填 |
| `IMAGE2_FALLBACK_BASE_URL` | 备用站地址，必填 |
| `IMAGE2_FALLBACK_API_KEY` | 备用站 API Key，必填 |
| `IMAGE2_MODEL` | 主站模型 ID，默认 `gpt-image-2` |
| `IMAGE2_FALLBACK_MODEL` | 备用站模型 ID，默认与主站相同 |
| `IMAGE2_TIMEOUT_MS` | 每次上游请求超时，单位毫秒，默认 `300000` |

将真实地址和密钥保存在仓库外的环境设置中，使 Codex 启动的 MCP 子进程可以读取。设置后重启 Codex。

## 使用

将完整插件目录导入所用 Codex 版本支持的插件安装入口，配置环境变量后，在新任务中请求使用 Image2 生图或编辑图片。

例如：

> 使用 Image2 生成一张暖色调的咖啡馆插画，画面中有落地窗、木桌和一只睡觉的橘猫。

也可以由支持 MCP 的客户端直接调用工具：

```json
{
  "name": "generate_image2",
  "arguments": {
    "prompt": "A cozy cafe illustration with a large window, wooden tables and a sleeping orange cat.",
    "size": "auto",
    "quality": "auto",
    "output_format": "png",
    "n": 1
  }
}
```

编辑图片时，调用 `edit_image2`，提供 `prompt` 和包含本地图片绝对路径的 `image_paths` 数组；需要蒙版时，可额外提供 `mask_path`。

工具成功返回图片内容，并在结构化结果中给出使用的模型以及 `primary` 或 `fallback` 服务标识。

## 接入其他 MCP 客户端

服务器支持 stdio 传输，可在其他 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "image2": {
      "command": "node",
      "args": ["/absolute/path/to/image2-imagegen/scripts/image2-mcp.cjs"]
    }
  }
}
```

将示例路径替换为自己的克隆路径，环境变量由父进程或客户端配置提供。

## 文件结构

```text
.codex-plugin/plugin.json
.mcp.json
scripts/image2-mcp.cjs
skills/use-image2/SKILL.md
skills/use-image2/agents/openai.yaml
.env.example
.gitignore
README.md
LICENSE
```

实际图片调用会将提示词和参考图片发送到使用者配置的服务，并可能产生费用。

## 许可证

本项目采用 [MIT License](LICENSE)。
