"""
Builds the Web Agent's own Kaggle notebooks (the CareFlow notebook, careflow_kaggle.ipynb, stays as it is):

    python kaggle/make_web_agent_notebook.py            # both
    python kaggle/make_web_agent_notebook.py qwen3vl4b  # one

  web_agent_qwen38_kaggle.ipynb    Qwen3.8 27B (qwen3.8:27b-q4_K_M, ~18 GB) across both T4s — the strongest
                                   tool-calling model that fits Kaggle's free GPU. The Ternary Bonsai 2 27B of the
                                   CareFlow notebook is made from it; ~2–3 minutes for a ten-step task.
  web_agent_qwen3vl4b_kaggle.ipynb Qwen3-VL 4B Instruct (qwen3-vl:4b-instruct-q8_0, ~5 GB) — small and fast, sees
                                   images as well as text; one T4 is enough.

Both also run Whisper large-v3-turbo for voice. Import a notebook into Kaggle (File → Import Notebook), set the
Accelerator (GPU T4 x2 for Qwen3.8; GPU T4 or T4 x2 for Qwen3-VL) and Internet = On, change KEY, then Run All. It
prints the address and key for the extension → Models → Kaggle GPU, and the model to choose.

Cell 1 writes careflow_gpu_server.py (this folder's copy, unchanged — the same address, key header and voice API
the extension already uses); cell 2 installs and starts everything.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
server = (HERE / "careflow_gpu_server.py").read_text(encoding="utf-8")

LAUNCHER = r'''# Web Agent on Kaggle: @TITLE@ (Ollama) + Whisper large-v3-turbo, behind one address.
# Notebook settings: Accelerator = @ACCELERATOR@, Internet = On. Then Run All.
import os, re, shutil, subprocess, time

# The same key goes into the extension → Models → Kaggle GPU → Notebook key. Change it.
KEY = "CHANGE-ME"

MODEL = "@MODEL@"   # @MODEL_NOTE@
CTX = 16384                    # tokens per request — what the extension plans for on Kaggle
PARALLEL = "@PARALLEL@"                 # requests answered together; each holds its own CTX-token cache on the GPU.
                               # One for a slow model: each step of a task then reuses the cache of the step
                               # before (the instructions and the pages read so far are not read again).
LOAD_STALL_S = @LOAD_STALL_S@             # no new GPU memory for this long while loading = stuck
MIN_OLLAMA = (0, 12, 7)        # Qwen3-VL needs Ollama 0.12.7 or newer

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
gpus = gpu_info.count("\n") + 1
if gpus < @MIN_GPUS@:
    raise SystemExit("@TITLE@ needs both GPUs: set Accelerator = GPU T4 x2 (one T4 has 16 GB; the model alone is larger).")

# 1. @TITLE@ on Ollama. The cache is stored at 8 bits (half the memory, same answers) and ~2 GB is left free on
#    each GPU, so Whisper fits next to it (on the second T4 when there are two).
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
def ollama_version():
    out = subprocess.run("ollama --version", shell=True, capture_output=True, text=True).stdout + " "
    found = re.search(r"(\d+)\.(\d+)\.(\d+)", out)
    return tuple(int(x) for x in found.groups()) if found else (0, 0, 0)

if not shutil.which("ollama") or ollama_version() < MIN_OLLAMA:  # installed by the last run already and new enough: keep it
    sh("curl -fsSL https://ollama.com/install.sh | sh")
start_ollama()
sh(f"ollama pull {MODEL}")  # @SIZE@ — the first run takes a while
sh("ollama list")
print(f"Loading {MODEL} into GPU memory…", flush=True)
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

# 2. Speech recognition: Whisper large-v3-turbo (faster-whisper, fp16) — on the second T4 when there are two.
sh("pip install -q faster-whisper fastapi uvicorn httpx")

# 3. The server (port 8000): the extension's address, key check, Ollama's chat with thinking off, /transcribe.
#    It restarts a stuck Ollama by itself, with the same settings (OLLAMA_ENV).
server = subprocess.Popen(["python", "/kaggle/working/careflow_gpu_server.py"],
                          env={**os.environ, **OLLAMA_ENV, "CAREFLOW_KEY": KEY, "CAREFLOW_NUM_CTX": str(CTX), "CAREFLOW_STT": "whisper",
                               "CAREFLOW_WHISPER": "large-v3-turbo", "CUDA_VISIBLE_DEVICES": "1" if gpus >= 2 else "0",
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


PRESETS = {
    "qwen38": {
        "@TITLE@": "Qwen3.8 27B", "@ACCELERATOR@": "GPU T4 x2", "@MODEL@": "qwen3.8:27b-q4_K_M",
        "@MODEL_NOTE@": "~18 GB, across both T4s; tools + thinking (the server turns thinking off unless asked)",
        "@PARALLEL@": "1", "@LOAD_STALL_S@": "300", "@MIN_GPUS@": "2", "@SIZE@": "~18 GB",
    },
    "qwen3vl4b": {
        "@TITLE@": "Qwen3-VL 4B Instruct", "@ACCELERATOR@": "GPU T4 (or GPU T4 x2)", "@MODEL@": "qwen3-vl:4b-instruct-q8_0",
        "@MODEL_NOTE@": "~5 GB at 8 bits (the 3.3 GB qwen3-vl:4b-instruct is Q4); text, images and tools",
        "@PARALLEL@": "4", "@LOAD_STALL_S@": "180", "@MIN_GPUS@": "1", "@SIZE@": "~5 GB",
    },
}


def cell(source: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source.splitlines(keepends=True)}


def build(name: str) -> Path:
    launcher = LAUNCHER
    for marker, value in PRESETS[name].items():
        launcher = launcher.replace(marker, value)
    assert not re.search(r"@[A-Z_]+@", launcher), "a marker was left unfilled"
    notebook = {
        "cells": [cell("%%writefile /kaggle/working/careflow_gpu_server.py\n" + server), cell(launcher)],
        "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python"}},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    out = HERE / f"web_agent_{name}_kaggle.ipynb"
    out.write_text(json.dumps(notebook, indent=1), encoding="utf-8")
    return out


for name in sys.argv[1:] or PRESETS:
    print("wrote", build(name))
