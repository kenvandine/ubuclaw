#!/usr/bin/env node
'use strict';
// Probes for local Lemonade and Ollama instances, configures whichever are
// running as OpenAI-compatible providers, and writes a minimal openclaw.json.
// Lemonade is preferred (primary) when both are present; Ollama becomes the
// fallback.  Exits 0 on success, 1 if neither service is reachable.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PROVIDERS = [
  {
    id:      'lemonade',
    baseUrl: 'http://localhost:8000/api/v1',
    apiKey:  'lemonade',
  },
  {
    id:      'ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey:  'ollama',
  },
];

const homeDir   = process.env.SNAP_USER_COMMON || require('os').homedir();
const CONFIG_DIR  = path.join(homeDir, '.openclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'openclaw.json');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function probeModels(baseUrl) {
  try {
    const body = await httpGet(`${baseUrl}/models`);
    const data = JSON.parse(body).data || [];
    return data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

function buildProviderConfig(baseUrl, apiKey, rawModels) {
  return {
    baseUrl,
    apiKey,
    api: 'openai-completions',
    models: rawModels.map(m => ({
      id:            m.id,
      name:          m.id,
      reasoning:     false,
      input:         ['text'],
      cost:          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.context_window || 32768,
      maxTokens:     m.max_tokens    || 4096,
    })),
  };
}

// Score a model ID for suitability as a primary chat/agent model.
// Higher = more preferred.  Image, audio, and embedding models score negative
// so they sink to the bottom and are never chosen as primary or fallback.
function modelScore(id) {
  const s = id.toLowerCase();
  if (/flux|sdxl|stable.diff/i.test(s))   return -30; // image generation
  if (/kokoro|whisper|tts|speech/i.test(s)) return -20; // audio / TTS
  if (/embed|retriev/i.test(s))             return -20; // embedding only
  let score = 0;
  if (s.includes('flm'))                    score += 20; // FLM preferred
  if (s.includes('gguf'))                   score += 10; // llamacpp GGUF
  if (/instruct|it-|chat/i.test(s))         score +=  5; // instruction-tuned
  return score;
}

async function main() {
  const available = [];

  for (const p of PROVIDERS) {
    const models = await probeModels(p.baseUrl);
    if (models) {
      available.push({ ...p, models });
      console.log(`ubuclaw: found ${p.id} with ${models.length} model(s): ${models.map(m => m.id).join(', ')}`);
    }
  }

  if (available.length === 0) {
    console.error('ubuclaw: no local providers found (lemonade, ollama); starting with safe defaults');
    process.exit(1);
  }

  // Build providers map — all models are registered so they remain accessible.
  // For primary/fallback selection only pick text-capable models (score >= 0),
  // sorted highest score first.  Lemonade still takes priority over Ollama.
  const providers = {};
  const modelIds  = [];

  for (const p of available) {
    providers[p.id] = buildProviderConfig(p.baseUrl, p.apiKey, p.models);
    const ranked = p.models
      .map(m => ({ id: `${p.id}/${m.id}`, score: modelScore(m.id) }))
      .filter(m => m.score >= 0)
      .sort((a, b) => b.score - a.score);
    modelIds.push(...ranked.map(m => m.id));
  }

  if (modelIds.length === 0) {
    // All detected models are image/audio — still start but warn.
    console.error('ubuclaw: no text models found; agent may not function correctly');
  }

  const [primary, ...fallbacks] = modelIds;

  const config = {
    gateway: {
      mode: 'local',
      // mode=token with no explicit token value: openclaw auto-generates and
      // persists a token on first gateway start, which the CLI then reads from
      // the shared config.  This avoids the "device identity required" error
      // and clears the two auth-missing CRITICAL warnings.
      auth: { mode: 'token' },
    },
    models: {
      mode: 'replace', // only use explicitly configured local providers; disables built-in cloud models
      providers,
    },
    agents: {
      defaults: {
        workspace: path.join(homeDir, 'workspace'),
        sandbox:   { mode: 'off' },
        model:     { primary, ...(fallbacks.length > 0 && { fallbacks }) },
      },
    },
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');

  console.log(`ubuclaw: primary model → ${primary}`);
  if (fallbacks.length > 0) {
    console.log(`ubuclaw: fallback model(s) → ${fallbacks.join(', ')}`);
  }
}

main().catch(err => {
  console.error(`ubuclaw: setup-providers failed: ${err.message}`);
  process.exit(1);
});
