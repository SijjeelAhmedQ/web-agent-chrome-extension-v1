"""
Builds web_agent_qwen38_kaggle.ipynb — a second Kaggle notebook (the first, careflow_kaggle.ipynb, stays as it is):
Qwen3.8 27B, the strongest tool-calling model that fits Kaggle's free GPU, and Whisper large-v3-turbo for voice.

    python kaggle/make_notebook_qwen38.py

Import the notebook into Kaggle (File → Import Notebook), set Accelerator = GPU T4 x2 and Internet = On, change KEY,
then Run All. It prints the address and key to put in the extension → Models → Kaggle GPU, with the model
qwen3.8:27b-q4_K_M.

Why this model: DeepSeek V4 Flash (284B parameters, ~13B active) needs far more than Kaggle's 2 × 16 GB. Qwen3.8 27B
(Q4_K_M, ~18 GB) is the dense model the Ternary Bonsai 2 27B of the first notebook is made from — Bonsai followed
the agent's workflows step by step in the Kaggle tests — at a less compressed quantization. It is split across both
T4s; Whisper runs on the second one. Expect ~2–4 minutes for a task of ten steps: a 27B model on T4s is slow.

Cell 1 writes careflow_gpu_server.py (this folder's copy, unchanged — the same address, key header and voice API
the extension already uses); cell 2 installs and starts everything.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
server = (HERE / "careflow_gpu_server.py").read_text(encoding="utf-8")

launcher = r'''# Web Agent on Kaggle: Qwen3.8 27B (Ollama, across both T4s) + Whisper large-v3-turbo, behind one address.
# Notebook settings: Accelerator = GPU T4 x2, Internet = On. Then Run All.
import os, re, shutil, subprocess, time

# The same key goes into the extension → Models → Kaggle GPU → Notebook key. Change it.
KEY = "CHANGE-ME"

MODEL = "qwen3.8:27b-q4_K_M"   # ~18 GB; tools + thinking (the server turns thinking off unless asked)
CTX = 16384                    # tokens per request — what the extension plans for on Kaggle
PARALLEL = "2"                 # requests answered together; each holds its own CTX-token cache on the GPU
LOAD_STALL_S = 300             # no new GPU memory for this long while loading = stuck (18 GB over two GPUs is slow)

def sh(cmd, check=True):
    print("$", cmd, flush=True)
    return subprocess.run(cmd, shell=True, check=check)

def answers(url, headers=None):
    import urllib.request
    try:
        urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=5)
        return True
    except Exception:
        return False

def gpu_used():
    """GPU memory in use on all GPUs together (MiB)."""
    out = subprocess.run("nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits", shell=True, capture_output=True, text=True).stdout
    return sum(int(x) for x in out.split() if x.strip().isdigit())

def tail(path, lines=1):
    """The last lines of a log — what a process is doing right now."""
    try:
        text = [l for l in open(path, errors="replace").read().replace("\r", "\n").splitlines() if l.strip()]
        return "\n".join(text[-lines:])
    except OSError:
        return ""

# 0. Run All again in the same session: the last run's server and tunnel still hold port 8000 — stop them first.
sh("pkill -f '[c]areflow_gpu_server.py'; pkill -x cloudflared; pkill -f '[l]lama-server'; sleep 3", check=False)

gpu_info = subprocess.run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader", shell=True, capture_output=True, text=True).stdout.strip()
print("GPU:", gpu_info or "none — set Accelerator = GPU T4 x2 in the notebook settings")
if not gpu_info:
    raise SystemExit("No GPU in this session.")
if gpu_info.count("\n") + 1 < 2:
    raise SystemExit("Qwen3.8 27B needs both GPUs: set Accelerator = GPU T4 x2 (one T4 has 16 GB; the model alone is ~18 GB).")

# 1. Qwen3.8 27B on Ollama, split across both T4s. The cache is stored at 8 bits (half the memory, same answers)
#    and ~2 GB is left free on each GPU, so Whisper fits next to it on the second T4.
OLLAMA_LOG = "/kaggle/working/ollama.log"
OLLAMA_ENV = {"OLLAMA_CONTEXT_LENGTH": str(CTX), "OLLAMA_KEEP_ALIVE": "-1", "OLLAMA_NUM_PARALLEL": PARALLEL,
              "OLLAMA_MAX_LOADED_MODELS": "1", "OLLAMA_FLASH_ATTENTION": "1", "OLLAMA_KV_CACHE_TYPE": "q8_0",
              "OLLAMA_GPU_OVERHEAD": str(2 * 1024 ** 3)}

def start_ollama():
    """Ollama afresh: one left over from an earlier run may be stuck."""
    sh("pkill -x ollama; sleep 3", check=False)
    subprocess.Popen(["ollama", "serve"], stdout=open(OLLAMA_LOG, "a"), stderr=subprocess.STDOUT,
                     env={**os.environ, **OLLAMA_ENV}, start_new_session=True)
    for _ in range(30):
        time.sleep(2)
        if answers("http://127.0.0.1:11434/api/version"):
            return
    print(tail(OLLAMA_LOG, 40))
    raise SystemExit("Ollama did not start — the log above says why.")

def in_memory():
    import json, urllib.request
    try:
        return [m["name"] for m in json.load(urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=5)).get("models", [])]
    except Exception:
        return []

def load(model):
    """Load the model into GPU memory with the extension's context size. False when it makes no progress for LOAD_STALL_S."""
    import json, threading, urllib.request
    body = json.dumps({"model": model, "keep_alive": -1, "options": {"num_ctx": CTX}}).encode()
    def request():
        try:
            urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/generate", data=body, headers={"Content-Type": "application/json"}), timeout=1800).read()
        except Exception as exc:
            print(f"   {model}: {exc}", flush=True)
    worker = threading.Thread(target=request, daemon=True)
    worker.start()
    started = progress = time.time()
    last = gpu_used()
    while worker.is_alive():
        worker.join(5)
        used = gpu_used()
        if used >= last + 128:
            last, progress = used, time.time()
        if time.time() - progress >= LOAD_STALL_S:
            return False
        if int(time.time() - started) % 30 < 5:
            print(f"   loading {model}: {int(time.time() - started)} s, GPU memory {used} MiB", flush=True)
    return model in in_memory()

sh("apt-get update -qq && apt-get install -y -qq zstd")
if not shutil.which("ollama"):  # installed by the last run already: keep it
    sh("curl -fsSL https://ollama.com/install.sh | sh")
start_ollama()
sh(f"ollama pull {MODEL}")  # ~18 GB — the first run takes a while
sh("ollama list")
print(f"Loading {MODEL} into GPU memory (both T4s)…", flush=True)
t0 = time.time()
if not load(MODEL):
    print(f"{MODEL} made no progress for {LOAD_STALL_S} s — restarting Ollama and trying once more", flush=True)
    start_ollama()
    if not load(MODEL):
        print(tail(OLLAMA_LOG, 60))
        raise SystemExit(f"{MODEL} would not load into GPU memory — Ollama's log above says why.")
print(f"   {MODEL} loaded in {int(time.time() - t0)} s", flush=True)
sh("ollama ps")
sh("nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv")

# 2. Speech recognition: Whisper large-v3-turbo (faster-whisper, fp16) — on the second T4, next to its half of the model.
sh("pip install -q faster-whisper fastapi uvicorn httpx")

# 3. The server (port 8000): the extension's address, key check, Ollama's chat with thinking off, /transcribe.
#    It restarts a stuck Ollama by itself, with the same settings (OLLAMA_ENV).
server = subprocess.Popen(["python", "/kaggle/working/careflow_gpu_server.py"],
                          env={**os.environ, **OLLAMA_ENV, "CAREFLOW_KEY": KEY, "CAREFLOW_NUM_CTX": str(CTX), "CAREFLOW_STT": "whisper",
                               "CAREFLOW_WHISPER": "large-v3-turbo", "CUDA_VISIBLE_DEVICES": "1",
                               "CAREFLOW_KEEP_ALIVE": "-1", "CAREFLOW_LOAD_STALL_S": str(LOAD_STALL_S), "CAREFLOW_OLLAMA_LOG": OLLAMA_LOG},
                          stdout=open("/kaggle/working/server.log", "w"), stderr=subprocess.STDOUT)
print("Starting the server — the first start downloads Whisper large-v3-turbo (~1.6 GB)…", flush=True)
started = time.time()
for step in range(240):  # up to 20 minutes
    time.sleep(5)
    if answers("http://127.0.0.1:8000/health", {"X-CareFlow-Key": KEY}) or server.poll() is not None:
        break
    if step % 6 == 5:  # every 30 seconds
        print(f"   server: {int(time.time() - started) // 60} min · {tail('/kaggle/working/server.log')[:160]}", flush=True)
print(open("/kaggle/working/server.log").read()[-2000:])
if server.poll() is not None:
    raise SystemExit("The server stopped — the log above says why.")
sh("nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv")

# 4. The public address: a Cloudflare quick tunnel (free, no account).
if not os.access("/kaggle/working/cloudflared", os.X_OK):  # downloaded by the last run already: reuse it
    sh("wget -q -O /kaggle/working/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /kaggle/working/cloudflared")
tunnel = subprocess.Popen(["/kaggle/working/cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8000"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for line in tunnel.stdout:
    found = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
    if found:
        print("=" * 64)
        print("Web Agent → Models → Kaggle GPU")
        print("  Server address:", found.group(0))
        print("  Notebook key:  ", KEY)
        print("  Model:         ", MODEL, "— in GPU memory now:", ", ".join(in_memory()) or "none yet")
        print("  Voice:          Whisper large-v3-turbo (same address and key)")
        print("Keep this notebook running while you use the extension.")
        print("=" * 64, flush=True)
        break
'''


def cell(source: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source.splitlines(keepends=True)}


notebook = {
    "cells": [cell("%%writefile /kaggle/working/careflow_gpu_server.py\n" + server), cell(launcher)],
    "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 5,
}
(HERE / "web_agent_qwen38_kaggle.ipynb").write_text(json.dumps(notebook, indent=1), encoding="utf-8")
print("wrote", HERE / "web_agent_qwen38_kaggle.ipynb")
