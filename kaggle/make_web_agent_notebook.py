"""
Builds the Web Agent's own Kaggle notebooks (the CareFlow notebook, careflow_kaggle.ipynb, stays as it is):

    python kaggle/make_web_agent_notebook.py            # both
    python kaggle/make_web_agent_notebook.py qwen3vl4b  # one

  web_agent_qwen38_kaggle.ipynb    Qwen3.8 27B (qwen3.8:27b-q4_K_M, ~18 GB) across both T4s — the strongest
                                   tool-calling model that fits Kaggle's free GPU. The Ternary Bonsai 2 27B of the
                                   CareFlow notebook is made from it; ~2–3 minutes for a ten-step task.
  web_agent_qwen38long_kaggle.ipynb  The same Qwen3.8 27B with 64k tokens of context instead of 16k — for long
                                   requests (several forms one after another). Set Context window = 65536 in the
                                   extension (Models → Kaggle GPU). Still the strongest tool-calling model that fits.
  web_agent_test_kaggle.ipynb      The testing notebook: Qwen3.8 27B with 64k context (as qwen38long), and a self-test
                                   (one tool call through the server) before it prints the address, and the two
                                   KAGGLE_URL / KAGGLE_KEY lines for the test scripts' env file.
  All of them install Ollama without apt-get (it can hang on Kaggle) and say how far its download is.
  web_agent_qwen3vl4b_kaggle.ipynb Qwen3-VL 4B Instruct (qwen3-vl:4b-instruct-q8_0, ~5 GB) — small and fast, sees
                                   images as well as text; one T4 is enough.

Both also run Whisper large-v3-turbo for voice. Import a notebook into Kaggle (File → Import Notebook), set the
Accelerator (GPU T4 x2 for Qwen3.8; GPU T4 or T4 x2 for Qwen3-VL) and Internet = On, set the key (KEY, or better a
secret WEB_AGENT_KEY under Add-ons → Secrets), then Run All. It prints the address and key for the extension →
Models → Kaggle GPU, and the model to choose.

Staying up: the last cell never ends — it watches the server and the tunnel every minute, restarts what stopped and
prints a NEW address when the tunnel had to be reopened. An interactive session still stops when the tab is left
idle; for hours of use, run it as Save Version → "Save & Run All (Commit)" (up to 12 hours; the address is in the
version's log). Kaggle's free GPU time is about 30 hours a week.

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

# The same key goes into the extension → Models → Kaggle GPU → Notebook key. Change it — or, better, add it as a
# Kaggle secret named WEB_AGENT_KEY (Add-ons → Secrets): then it is not in the notebook when you save a version.
KEY = "CHANGE-ME"
try:
    from kaggle_secrets import UserSecretsClient
    KEY = UserSecretsClient().get_secret("WEB_AGENT_KEY") or KEY
except Exception:
    pass
# No key set (the secret not attached to this notebook): a random one for this run — never “CHANGE-ME”, which anyone
# who finds the address could use. It is printed below; attach the WEB_AGENT_KEY secret to keep one key every run.
if KEY == "CHANGE-ME":
    import secrets
    KEY = secrets.token_urlsafe(24)
    print("No WEB_AGENT_KEY secret attached (Add-ons → Secrets → tick it for this notebook): this run uses a new random key, printed at the end.", flush=True)

MODEL = "@MODEL@"   # @MODEL_NOTE@
CTX = @CTX@                    # tokens per request — set the same Context window in the extension (Models → Kaggle GPU)
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

def ollama_version():
    out = subprocess.run("ollama --version", shell=True, capture_output=True, text=True).stdout + " "
    found = re.search(r"(\d+)\.(\d+)\.(\d+)", out)
    return tuple(int(x) for x in found.groups()) if found else (0, 0, 0)

def install_ollama():
    """Ollama without apt-get: on Kaggle `apt-get update` can hang for good (and install.sh needs zstd, which Kaggle
    lacks). With zstd there, install.sh; without, Ollama's own release unpacked here with Python's zstandard."""
    if shutil.which("zstd"):
        sh("curl -fsSL https://ollama.com/install.sh | sh")
        return
    import tarfile, urllib.request
    sh("pip install -q zstandard")
    import zstandard

    class Progress:
        """The download, read as it is unpacked — a line every 250 MB, so a slow one is not taken for a stuck one."""
        def __init__(self, res):
            self.res, self.got, self.shown, self.started = res, 0, 0, time.time()
        def read(self, n=-1):
            data = self.res.read(n)
            self.got += len(data)
            if self.got - self.shown >= 250 * 1024 ** 2:
                self.shown = self.got
                print(f"   Ollama: {self.got // 1024 ** 2} MB in {int(time.time() - self.started)} s", flush=True)
            return data

    url = "https://ollama.com/download/ollama-linux-amd64.tar.zst"
    print("$ (python) download and unpack", url, "→ /usr/local", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as res:
            with zstandard.ZstdDecompressor().stream_reader(Progress(res)) as raw:
                with tarfile.open(fileobj=raw, mode="r|") as tar:
                    try:
                        tar.extractall("/usr/local", filter="tar")
                    except TypeError:  # an older Python without extraction filters
                        tar.extractall("/usr/local")
    except Exception as exc:  # an older release ships as .tgz
        print("   .tar.zst failed:", exc, "— trying the .tgz", flush=True)
        sh("curl -fsSL https://ollama.com/download/ollama-linux-amd64.tgz | tar -xzf - -C /usr/local")
    if not shutil.which("ollama"):
        raise SystemExit("Ollama did not install — the lines above say why.")

if not shutil.which("ollama") or ollama_version() < MIN_OLLAMA:  # installed by the last run already and new enough: keep it
    install_ollama()
print("Ollama", ".".join(map(str, ollama_version())), flush=True)
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
# Whisper on the GPU needs CUDA 12's cuBLAS and cuDNN, which this image may lack (“libcublas.so.12 is not found” —
# then it runs on the CPU, slowly): from pip, and their folders on the library path of the server.
sh("pip install -q nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*'", check=False)

def cuda_libs():
    """The lib folders of the pip-installed CUDA libraries, for LD_LIBRARY_PATH."""
    found = []
    for name in ("nvidia.cublas.lib", "nvidia.cudnn.lib"):
        try:
            import importlib
            module = importlib.import_module(name)
            found += [p for p in getattr(module, "__path__", [])]
        except Exception:
            pass
    return ":".join(found + [os.environ.get("LD_LIBRARY_PATH", "")]).strip(":")

# 2b. Headroom (github.com/headroomlabs-ai/headroom): its proxy compresses each call's messages before the model gets
#     them — the extension asks it at <address>/headroom/v1/compress (Models → Kaggle GPU → Headroom proxy). Here only,
#     on loopback; nothing about the patients leaves the notebook: its beacon, update check and telemetry are off, and
#     CCR (originals fetched back through a tool the model doesn't have here) is off too.
HEADROOM_LOG = "/kaggle/working/headroom.log"
HEADROOM_ENV = {"HEADROOM_TELEMETRY": "off", "HEADROOM_BEACON": "off", "DO_NOT_TRACK": "1", "HEADROOM_UPDATE_CHECK": "off", "HEADROOM_NO_CCR": "1"}
sh('pip install -q "headroom-ai[proxy]"', check=False)

def start_headroom():
    """Headroom's proxy on 127.0.0.1:8787 (None when it didn't install: the extension then sends messages as they are)."""
    if not shutil.which("headroom"):
        print("Headroom did not install — the extension will send messages uncompressed.", flush=True)
        return None
    sh("pkill -f '[h]eadroom proxy'; sleep 1", check=False)
    proc = subprocess.Popen(["headroom", "proxy", "--host", "127.0.0.1", "--port", "8787", "--no-ccr", "--no-telemetry"],
                            env={**os.environ, **HEADROOM_ENV}, stdout=open(HEADROOM_LOG, "a"), stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(60):
        time.sleep(2)
        if answers("http://127.0.0.1:8787/health") or proc.poll() is not None:
            break
    print("Headroom proxy:", "up" if answers("http://127.0.0.1:8787/health") else "NOT answering — " + tail(HEADROOM_LOG, 5), flush=True)
    return proc

headroom = start_headroom()

# 3. The server (port 8000): the extension's address, key check, Ollama's chat with thinking off, /transcribe.
#    It restarts a stuck Ollama by itself, with the same settings (OLLAMA_ENV).
def start_server():
    return subprocess.Popen(["python", "/kaggle/working/careflow_gpu_server.py"],
                            env={**os.environ, **OLLAMA_ENV, "CAREFLOW_KEY": KEY, "CAREFLOW_NUM_CTX": str(CTX), "CAREFLOW_STT": "whisper",
                                 "CAREFLOW_WHISPER": "large-v3-turbo", "CUDA_VISIBLE_DEVICES": "1" if gpus >= 2 else "0",
                                 "CAREFLOW_KEEP_ALIVE": "-1", "CAREFLOW_LOAD_STALL_S": str(LOAD_STALL_S), "CAREFLOW_OLLAMA_LOG": OLLAMA_LOG,
                                 "LD_LIBRARY_PATH": cuda_libs()},
                            stdout=open("/kaggle/working/server.log", "a"), stderr=subprocess.STDOUT)

server = start_server()
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

def self_test():
    """One request the way the extension sends it (address, key, a tool): does the model call the tool? It also warms
    the model up, so the extension's first step is not the slow one. Here on Kaggle — no other service, no cost."""
    import json, urllib.request
    body = {"model": MODEL, "max_tokens": 200, "messages": [
                {"role": "system", "content": "You control a web page through tools."},
                {"role": "user", "content": "Click the Search button. Its id is 7."}],
            "tools": [{"type": "function", "function": {"name": "click", "description": "Click an element by its id.",
                       "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}}}]}
    t = time.time()
    try:
        req = urllib.request.Request("http://127.0.0.1:8000/vllm/v1/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "X-CareFlow-Key": KEY})
        res = json.load(urllib.request.urlopen(req, timeout=600))
        calls = res["choices"][0]["message"].get("tool_calls") or []
        took = round(time.time() - t, 1)
        if calls:
            fn = calls[0]["function"]
            print(f"Self-test OK: the model called {fn['name']}({fn['arguments']}) in {took} s · usage {res.get('usage')}", flush=True)
        else:
            print(f"Self-test: an answer but no tool call ({took} s) — {str(res['choices'][0]['message'])[:300]}", flush=True)
    except Exception as exc:
        print("Self-test failed:", exc, "\n", tail("/kaggle/working/server.log", 20), flush=True)

self_test()

# 4. The public address: a Cloudflare quick tunnel (free, no account).
if not os.access("/kaggle/working/cloudflared", os.X_OK):  # downloaded by the last run already: reuse it
    sh("wget -q -O /kaggle/working/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /kaggle/working/cloudflared")
# Its log goes to a file, not a pipe: a pipe nobody reads fills up, and then cloudflared stalls and the address dies.
TUNNEL_LOG = "/kaggle/working/tunnel.log"

def start_tunnel():
    """A new quick tunnel and its address (a new one each time). Cloudflare refuses quick tunnels for a while when
    too many were asked for (status 429): waited out, then asked again — not the end of the notebook."""
    for attempt, pause in enumerate([0, 30, 60, 120, 240, 300], start=1):
        if pause:
            print(f"   Cloudflare is limiting new tunnels (429) — trying again in {pause} s (attempt {attempt} of 6)", flush=True)
            time.sleep(pause)
        sh("pkill -x cloudflared; sleep 2", check=False)
        proc = subprocess.Popen(["/kaggle/working/cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8000"],
                                stdout=open(TUNNEL_LOG, "w"), stderr=subprocess.STDOUT)
        for _ in range(90):
            time.sleep(1)
            log = open(TUNNEL_LOG, errors="replace").read()
            # The tunnel's own address — random words, e.g. https://neither-specialized-granny.trycloudflare.com —
            # not api.trycloudflare.com, which its error lines name (it was once printed as the address).
            found = re.search(r"https://(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com", log)
            if found:
                return proc, found.group(0)
            if re.search(r"status 429|Too Many Requests", log) or proc.poll() is not None:
                break
        if not re.search(r"status 429|Too Many Requests", open(TUNNEL_LOG, errors="replace").read()):
            break
    raise SystemExit("No tunnel address — " + tail(TUNNEL_LOG, 20))

def banner(url, note=""):
    print("=" * 64)
    print("Web Agent → Models → Kaggle GPU" + (f"   ({note})" if note else ""))
    print("  Server address:", url)
    print("  Notebook key:  ", KEY if KEY != "CHANGE-ME" else "CHANGE-ME — set KEY or the WEB_AGENT_KEY secret")
    print("  Model:         ", MODEL, "— in GPU memory now:", ", ".join(in_memory()) or "none yet")
    print("  Context window:", CTX, "— set the same number in the extension")
    print("  Voice:          Whisper large-v3-turbo (same address and key)")
    print("  Headroom proxy:", f"{url}/headroom  — in the extension's Kaggle GPU connection (same key)" if headroom else "off (it didn't install)")
    print("For the test scripts (C:/Users/92313/.webagent-kaggle.env), these two lines:")
    print(f"  KAGGLE_URL={url}")
    print(f"  KAGGLE_KEY={KEY}")
    print("Keep this notebook running while you use the extension.")
    print("=" * 64, flush=True)

tunnel, url = start_tunnel()
banner(url)

# 5. Stay up. This cell never ends: a finished notebook is an idle one, and Kaggle stops idle sessions. To keep it
#    running for hours without this tab open, use Save Version → “Save & Run All (Commit)” — the address is then in
#    the version's log (Kaggle runs a session for up to 12 hours). Every minute: the server and the tunnel are
#    checked and restarted if they stopped (a restarted tunnel has a NEW address — printed here).
started_at, last_note = time.time(), 0.0
while True:
    time.sleep(60)
    if headroom is not None and headroom.poll() is not None:
        print(tail(HEADROOM_LOG, 20))
        print("Headroom stopped — starting it again.", flush=True)
        headroom = start_headroom()
    if server.poll() is not None:
        print(tail("/kaggle/working/server.log", 30))
        print("The server stopped — starting it again.", flush=True)
        server = start_server()
        for _ in range(60):
            time.sleep(5)
            if answers("http://127.0.0.1:8000/health", {"X-CareFlow-Key": KEY}):
                break
    if tunnel.poll() is not None or not answers(url + "/health", {"X-CareFlow-Key": KEY}):
        time.sleep(10)  # one slow answer is not a dead tunnel
        if tunnel.poll() is not None or not answers(url + "/health", {"X-CareFlow-Key": KEY}):
            print("The tunnel stopped answering — opening a new one.", flush=True)
            try:
                tunnel, url = start_tunnel()
                banner(url, "NEW address — change it in the extension")
            except SystemExit as exc:  # Cloudflare still refusing: the model and server stay up, try again next minute
                print(f"   No new tunnel yet ({exc}) — trying again in a minute.", flush=True)
    if time.time() - last_note >= 600:
        last_note = time.time()
        print(f"[{time.strftime('%H:%M')}] up {int((time.time() - started_at) // 60)} min · {url} · in GPU memory: {', '.join(in_memory()) or 'none'}", flush=True)
'''


PRESETS = {
    "qwen38": {
        "@TITLE@": "Qwen3.8 27B", "@ACCELERATOR@": "GPU T4 x2", "@MODEL@": "qwen3.8:27b-q4_K_M",
        "@MODEL_NOTE@": "~18 GB, across both T4s; tools + thinking (the server turns thinking off unless asked)",
        "@PARALLEL@": "1", "@LOAD_STALL_S@": "300", "@MIN_GPUS@": "2", "@SIZE@": "~18 GB", "@CTX@": "16384",
    },
    # The same model with four times the room: only 16 of its 64 layers keep a KV cache (the rest are Gated
    # DeltaNet, a fixed-size state), ~32 KB a token at q8_0 — 64k tokens is ~2 GB beside the ~18 GB of weights.
    # Long requests (a medication, a task, a recall and a diagnosis in one go) then keep their workflow and
    # steps instead of having them cut to fit, and the prompt is rarely rewritten, so each step reuses the cache.
    "qwen38long": {
        "@TITLE@": "Qwen3.8 27B, 64k context", "@ACCELERATOR@": "GPU T4 x2", "@MODEL@": "qwen3.8:27b-q4_K_M",
        "@MODEL_NOTE@": "~18 GB across both T4s + ~2 GB of cache for 64k tokens; tools (the server turns thinking off unless asked)",
        "@PARALLEL@": "1", "@LOAD_STALL_S@": "300", "@MIN_GPUS@": "2", "@SIZE@": "~18 GB", "@CTX@": "65536",
    },
    # The testing notebook: the long one, for the extension and the test scripts alike (both use the address and key
    # it prints). MODEL can be any Ollama model with tools that fits ~28 GB; set Context window to CTX in the extension.
    "test": {
        "@TITLE@": "Qwen3.8 27B (testing), 64k context", "@ACCELERATOR@": "GPU T4 x2", "@MODEL@": "qwen3.8:27b-q4_K_M",
        "@MODEL_NOTE@": "~18 GB across both T4s + ~2 GB of cache for 64k tokens; tools (the server turns thinking off unless asked)",
        "@PARALLEL@": "1", "@LOAD_STALL_S@": "300", "@MIN_GPUS@": "2", "@SIZE@": "~18 GB", "@CTX@": "65536",
    },
    "qwen3vl4b": {
        "@TITLE@": "Qwen3-VL 4B Instruct", "@ACCELERATOR@": "GPU T4 (or GPU T4 x2)", "@MODEL@": "qwen3-vl:4b-instruct-q8_0",
        "@MODEL_NOTE@": "~5 GB at 8 bits (the 3.3 GB qwen3-vl:4b-instruct is Q4); text, images and tools",
        "@PARALLEL@": "4", "@LOAD_STALL_S@": "180", "@MIN_GPUS@": "1", "@SIZE@": "~5 GB", "@CTX@": "16384",
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
