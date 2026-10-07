#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const SERVER_NAME = "image2-imagegen";
const SERVER_VERSION = "0.1.0";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_TIMEOUT_MS = 300000;
const PROTOCOL_VERSION = "2025-06-18";
const PRIMARY_ATTEMPTS = 2;
const FALLBACK_ATTEMPTS = 2;

const tools = [
  {
    name: "generate_image2",
    title: "Generate with GPT Image 2",
    description: "Generate raster images with GPT Image 2. Use this instead of Codex's built-in image generator whenever the Image2 plugin is active.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: { type: "string", minLength: 1, description: "The complete image prompt." },
        size: { type: "string", default: "auto", description: "auto or WIDTHxHEIGHT. Dimensions must satisfy GPT Image 2 constraints." },
        quality: { type: "string", enum: ["auto", "low", "medium", "high"], default: "auto" },
        background: { type: "string", enum: ["auto", "opaque"], default: "auto" },
        output_format: { type: "string", enum: ["png", "jpeg", "webp"], default: "png" },
        output_compression: { type: "integer", minimum: 0, maximum: 100, description: "JPEG/WebP compression level." },
        n: { type: "integer", minimum: 1, maximum: 4, default: 1 }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "edit_image2",
    title: "Edit with GPT Image 2",
    description: "Edit or combine local raster images with GPT Image 2. Supply one or more absolute local image paths.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt", "image_paths"],
      properties: {
        prompt: { type: "string", minLength: 1, description: "The desired edit or reference-image composition." },
        image_paths: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", minLength: 1 } },
        mask_path: { type: "string", minLength: 1, description: "Optional absolute PNG mask path." },
        size: { type: "string", default: "auto", description: "auto or WIDTHxHEIGHT." },
        quality: { type: "string", enum: ["auto", "low", "medium", "high"], default: "auto" },
        background: { type: "string", enum: ["auto", "opaque"], default: "auto" },
        output_format: { type: "string", enum: ["png", "jpeg", "webp"], default: "png" },
        output_compression: { type: "integer", minimum: 0, maximum: 100 },
        n: { type: "integer", minimum: 1, maximum: 4, default: 1 }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }
];

function config() {
  const primaryApiKey = process.env.IMAGE2_API_KEY?.trim();
  const fallbackApiKey = process.env.IMAGE2_FALLBACK_API_KEY?.trim();
  if (!primaryApiKey) throw new Error("IMAGE2_API_KEY is not configured. Set it in the environment and restart Codex.");
  if (!fallbackApiKey) throw new Error("IMAGE2_FALLBACK_API_KEY is not configured. Set it in the environment and restart Codex.");
  const primaryBaseUrl = process.env.IMAGE2_BASE_URL?.trim();
  const fallbackBaseUrl = process.env.IMAGE2_FALLBACK_BASE_URL?.trim();
  if (!primaryBaseUrl) throw new Error("IMAGE2_BASE_URL is not configured. Set your own primary endpoint.");
  if (!fallbackBaseUrl) throw new Error("IMAGE2_FALLBACK_BASE_URL is not configured. Set your own fallback endpoint.");
  const model = (process.env.IMAGE2_MODEL || DEFAULT_MODEL).trim();
  return {
    timeoutMs: Number(process.env.IMAGE2_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    providers: [
      {
        name: "primary",
        apiKey: primaryApiKey,
        baseUrl: primaryBaseUrl.replace(/\/+$/, ""),
        model,
        attempts: PRIMARY_ATTEMPTS
      },
      {
        name: "fallback",
        apiKey: fallbackApiKey,
        baseUrl: fallbackBaseUrl.replace(/\/+$/, ""),
        model: (process.env.IMAGE2_FALLBACK_MODEL || model).trim(),
        attempts: FALLBACK_ATTEMPTS
      }
    ]
  };
}

function endpoint(baseUrl, route) {
  return `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}${route}`;
}

function validateSize(value) {
  if (!value || value === "auto") return "auto";
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error("size must be 'auto' or WIDTHxHEIGHT, for example 1536x1024.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655360 || pixels > 8294400) {
    throw new Error("Invalid GPT Image 2 size: edges must be multiples of 16, at most 3840 px, ratio at most 3:1, and total pixels 655,360-8,294,400.");
  }
  return value;
}

function commonParams(args, model) {
  const params = {
    model,
    prompt: args.prompt,
    size: validateSize(args.size || "auto"),
    quality: args.quality || "auto",
    background: args.background || "auto",
    output_format: args.output_format || "png",
    n: args.n || 1
  };
  if (args.output_compression !== undefined) params.output_compression = args.output_compression;
  return params;
}

async function requestJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) {
      const message = body?.error?.message || body?.message || body?.raw || `HTTP ${response.status}`;
      throw new Error(`Image2 upstream error (${response.status}): ${String(message).slice(0, 1000)}`);
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Image2 request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mimeFor(format) {
  return format === "jpg" || format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}

async function imageContent(body, requestedFormat, cfg) {
  if (!Array.isArray(body?.data) || body.data.length === 0) throw new Error("Image2 returned no image data.");
  const content = [{ type: "text", text: `Generated ${body.data.length} image(s) with ${cfg.model}.` }];
  for (const item of body.data) {
    if (item?.b64_json) {
      content.push({ type: "image", data: item.b64_json, mimeType: mimeFor(requestedFormat) });
      continue;
    }
    if (item?.url) {
      const response = await fetch(item.url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
      if (!response.ok) throw new Error(`Could not download generated image URL (HTTP ${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      content.push({ type: "image", data: bytes.toString("base64"), mimeType: response.headers.get("content-type")?.split(";")[0] || mimeFor(requestedFormat) });
      continue;
    }
    throw new Error("Image2 response item contained neither b64_json nor url.");
  }
  return { content, structuredContent: { created: body.created || null, count: body.data.length, model: cfg.model, provider: cfg.name } };
}

function errorSummary(error) {
  let message = String(error?.message || error);
  for (const variable of ["IMAGE2_API_KEY", "IMAGE2_FALLBACK_API_KEY"]) {
    const secret = process.env[variable]?.trim();
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[a-z0-9_-]{16,}/gi, "[redacted]").slice(0, 1000);
}

async function withFailover(cfg, operation) {
  const failures = [];
  for (const provider of cfg.providers) {
    for (let attempt = 1; attempt <= provider.attempts; attempt += 1) {
      try {
        return await operation(provider);
      } catch (error) {
        failures.push(`${provider.name} attempt ${attempt}/${provider.attempts}: ${errorSummary(error)}`);
      }
    }
  }
  throw new Error(`All Image2 providers failed. ${failures.join(" | ")}`);
}

async function generate(args) {
  const cfg = config();
  return withFailover(cfg, async (provider) => {
    const params = commonParams(args, provider.model);
    const body = await requestJson(endpoint(provider.baseUrl, "/images/generations"), {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(params)
    }, cfg.timeoutMs);
    return imageContent(body, params.output_format, provider);
  });
}

function absoluteReadableFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${resolved}`);
  return resolved;
}

function blobFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return new Blob([fs.readFileSync(filePath)], { type });
}

async function edit(args) {
  const cfg = config();
  const imagePaths = args.image_paths.map((source) => absoluteReadableFile(source, "image_path"));
  const maskPath = args.mask_path ? absoluteReadableFile(args.mask_path, "mask_path") : null;
  return withFailover(cfg, async (provider) => {
    const params = commonParams(args, provider.model);
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, String(value));
    for (const filePath of imagePaths) form.append("image[]", blobFor(filePath), path.basename(filePath));
    if (maskPath) form.append("mask", blobFor(maskPath), path.basename(maskPath));
    const body = await requestJson(endpoint(provider.baseUrl, "/images/edits"), {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: "application/json" },
      body: form
    }, cfg.timeoutMs);
    return imageContent(body, params.output_format, provider);
  });
}

async function callTool(name, args) {
  if (name === "generate_image2") return generate(args || {});
  if (name === "edit_image2") return edit(args || {});
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Use generate_image2 and edit_image2 for every raster image request while this plugin is active. The server tries the primary endpoint twice, then the configured fallback endpoint twice. Do not use Codex's built-in image generator unless the user explicitly asks."
    } });
    return;
  }
  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments);
      send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: errorSummary(error) }] } });
    }
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  try { await handle(JSON.parse(line)); }
  catch (error) { process.stderr.write(`${errorSummary(error)}\n`); }
});
