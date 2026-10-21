// Mimics kaggle/careflow_gpu_server.py: key header, /vllm/v1 (OpenAI), /transcribe, /health.
// medgemma rejects tools the way Ollama does. Listens on :4610.
import http from 'node:http';

const KEY = 'test-key';
const SCRIPT = JSON.parse(process.env.TRANSCRIPTS ?? '[]');
export const seen = [];
http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.headers['x-careflow-key'] !== KEY) return json(401, { detail: 'Wrong or missing X-CareFlow-Key' });
    if (url.pathname === '/health') return json(200, { ok: true, default: 'whisper', gpu: 'Tesla T4, 9000 MiB, 15360 MiB', engines: { whisper: { model: 'whisper-large-v3-turbo', device: 'cuda' }, omi: { model: 'omi-med-stt-v1 (gguf q8_0)', device: 'cuda' } }, llm: { models: ['qwen3.5:9b', 'hf.co/unsloth/medgemma-4b-it-GGUF:Q4_K_M'], loaded: ['qwen3.5:9b'], bonsai: 'ready' } });
    if (url.pathname === '/transcribe') {
      const samples = body.length / 2;
      const partial = url.searchParams.get('partial') === '1';
      // TRANSCRIPTS: what each utterance “says”, in order. Partials peek at the current one.
      const text = SCRIPT.length ? (partial ? SCRIPT[0] : SCRIPT.shift()) : 'Summarize this page';
      console.log(`[kaggle] transcribe ${partial ? 'partial' : 'FINAL'} engine=${url.searchParams.get('engine')} seconds=${(samples / 16000).toFixed(1)} -> ${partial ? text.split(' ').slice(0, 3).join(' ') + '…' : text}`);
      return json(200, { text: partial ? text.split(' ').slice(0, 3).join(' ') : text, unclear: false, ms: 120 });
    }
    if (url.pathname === '/vllm/v1/chat/completions') {
      const reqBody = JSON.parse(body.toString());
      console.log(`[kaggle] chat model=${reqBody.model} tools=${reqBody.tools?.length ?? 0}`);
      if (/medgemma|notools/.test(reqBody.model) && reqBody.tools?.length) {
        return json(400, { error: { message: `Ollama: registry.ollama.ai/library/${reqBody.model} does not support tools`, code: 400 } });
      }
      const user = reqBody.messages.findLast((m) => m.role === 'user').content;
      const hasPage = /--- Current page ---[\s\S]*Clinic Test App/.test(user);
      // Heartbeat like the real server: leading spaces, then the JSON.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('   ');
      setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: hasPage ? 'Answer from MedGemma: the page lists Sara Ahmed, Bilal Raza and Hina Malik.' : 'Hello from Qwen on Kaggle.' }, finish_reason: 'stop' }] })), 300);
      return;
    }
    json(404, { detail: 'nf' });
  })
  .listen(4610, () => console.log('kaggle mock on 4610'));
