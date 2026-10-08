"""Complete scene, physical Meet publisher in a separate Pulsar process and two Solar CEF viewers."""
import argparse
import asyncio
import base64
import ctypes
import hashlib
import io
import json
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
from PIL import Image
from proof.pulsar_cef import Pulsar

parser = argparse.ArgumentParser(description=__doc__)
for name in ["pulsar", "orion", "meet", "source", "output"]:
    parser.add_argument("--" + name, required=True)
parser.add_argument("--camera", default="PC-LM1E Camera (0458:6006)")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
prefix = Path(args.output).resolve()
prefix.parent.mkdir(parents=True, exist_ok=True)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
origin = "http://127.0.0.1:" + str(port)
source = Path(args.source)
immutable = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in [source, source.with_suffix(".lsmlz")]}
report = {"result": "RUNNING", "boundary": "real loopback Meet/WebRTC, physical camera, separate publisher process; not a WAN/TURN proof",
          "frames": [], "broadcast": False, "mutatedLSMLSaved": False}
host = publisher = viewers = None


def http(path, data=None):
    request = urllib.request.Request(origin + path, data=None if data is None else json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=50) as response:
        return json.load(response)


def alive(pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    code = ctypes.c_ulong()
    try:
        return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
    finally:
        kernel.CloseHandle(handle)


async def wait_for(predicate, description):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(.3)
    raise RuntimeError("Timed out: " + description)


async def frame(phase, lane, filled, empty):
    name = "PulsarSceneSource" if lane == "program" else "SolarPreviewProof"
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        result = await viewers.request("GetSourceScreenshot", {"sourceName": name, "imageFormat": "png", "imageWidth": 1920, "imageHeight": 1080})
        data = base64.b64decode(result["imageData"].split(",", 1)[-1])
        image = Image.open(io.BytesIO(data)).convert("RGBA")
        colors = {slot: len({image.getpixel((x, y))[:3] for y in range(start + 12, start + 225, 4)
                            for x in range(36, 432, 4)}) for slot, start in [("@0", 287), ("@1", 550), ("@2", 813)]}
        if (image.getchannel("A").getextrema() == (255, 255)
                and image.getpixel((500, 100))[:3] == (43, 42, 42)
                and image.getpixel((1700, 700))[:3] == (0, 0, 0)
                and all(colors[slot] > 80 for slot in filled)
                and all(colors[slot] <= 2 for slot in empty)):
            path = Path(str(prefix) + "-" + phase + "-" + lane + ".png")
            path.write_bytes(data)
            report["frames"].append({"phase": phase, "lane": lane, "path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "peerSlotColors": colors})
            print("PEER_CEF", phase, lane, colors, flush=True)
            return
        await asyncio.sleep(.3)
    raise RuntimeError("Peer pixels incorrect: " + phase + "/" + lane + " " + str(colors))


async def main():
    global host, publisher, viewers
    owner_prefix = Path(args.orion) / prefix.parent.relative_to(root) / prefix.name
    owner_prefix.parent.mkdir(parents=True, exist_ok=True)
    command = ["node", "scripts/proof/cold-start-host.mjs", "--scene", str(source.with_suffix(".lsmlz")),
               "--orion", args.orion, "--meet", args.meet, "--camera", args.camera, "--port", str(port),
               "--storage", str(root / "build" / (prefix.name + "-cache")),
               "--orion-storage", str(Path(args.orion) / "build" / (prefix.name + "-cache")), "--output", str(owner_prefix)]
    host = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", creationflags=0x08000000)
    ready = threading.Event()
    def read():
        with Path(str(prefix) + "-host.log").open("w", encoding="utf-8") as output:
            for line in host.stdout:
                output.write(line); output.flush()
                if '"ready":true' in line:
                    ready.set()
    threading.Thread(target=read, daemon=True).start()
    if not ready.wait(35):
        raise RuntimeError("Host readiness timeout")
    initial = http("/health")
    peer = http("/peer/health")
    report["processes"] = {"parent": host.pid, "orion": initial["orionPid"], "native": initial["nativePid"], "meet": peer["meetPid"]}
    publisher = Pulsar(args.pulsar, Path(str(prefix) + "-publisher"))
    publisher.start(); await publisher.connect(); await publisher.show(origin + "/publisher.html")
    await wait_for(lambda: any(e.get("type") == "publisher-joined" for e in http("/health")["events"]), "physical publisher joined")
    viewers = Pulsar(args.pulsar, Path(str(prefix) + "-viewers"))
    viewers.start(); await viewers.connect()
    report["processes"].update(publisher=publisher.process.pid, viewers=viewers.process.pid)
    def url(lane):
        return origin + "/host.html?" + urllib.parse.urlencode({"lsdp": initial["native"], "resource": "solar/" + lane})
    await viewers.show(url("program"))
    current = await viewers.request("GetCurrentProgramScene")
    await viewers.request("CreateInput", {"sceneName": current["currentProgramSceneName"], "inputName": "SolarPreviewProof", "inputKind": "browser_source",
                          "inputSettings": {"url": url("preview"), "width": 1920, "height": 1080, "fps": 60, "shutdown": False}, "sceneItemEnabled": True})
    http("/select", {})
    await wait_for(lambda: all(http("/state")["state"].get("scene_control", {}).get("defaults", {}).get("observed", {}).get(lane, {}).get("status") == "active"
                              for lane in ["program", "preview"]), "both scenes presented and activated")
    for lane in ["program", "preview"]:
        http("/peer/action", {"type": "assign", "lane": lane, "slot": "@0"})
    for lane in ["program", "preview"]:
        await frame("joined", lane, ["@0"], ["@1", "@2"])
    await wait_for(lambda: all(any(e.get("lane") == "solar/" + lane and e.get("type") == "rtc" and e["state"] == "connected"
                               and any(m["type"] == "inbound-rtp" and m["framesDecoded"] > 5 for m in e["media"])
                               for e in http("/health")["events"]) for lane in ["program", "preview"]), "both viewers decoded RTP frames")
    report["connectedEvents"] = [e for e in http("/health")["events"] if e.get("type") == "rtc" and e["state"] == "connected"]
    http("/peer/action", {"type": "pause"})
    for lane in ["program", "preview"]:
        await frame("left", lane, [], ["@0", "@1", "@2"])
    await wait_for(lambda: http("/peer/health")["peers"] == 2, "publisher removed from authoritative roster")
    http("/peer/action", {"type": "join"})
    for lane in ["program", "preview"]:
        await frame("rejoined", lane, ["@0"], ["@1", "@2"])
    http("/peer/action", {"type": "assign", "lane": "program", "slot": "@1"})
    await frame("reassigned", "program", ["@1"], ["@0", "@2"])
    await frame("reassigned", "preview", ["@0"], ["@1", "@2"])
    http("/peer/action", {"type": "clear", "lane": "preview"})
    await frame("released", "program", ["@1"], ["@0", "@2"])
    await frame("released", "preview", [], ["@0", "@1", "@2"])
    for e in report["connectedEvents"]:
        if e["lane"].startswith("solar/") and any(m["type"] == "outbound-rtp" and m["bytesSent"] > 0 for m in e["media"]):
            raise RuntimeError("Receive-only viewer published video")
    report["result"] = "PASS_REAL_PEER_CEF"


try:
    asyncio.run(main())
except Exception as error:
    report.update(result="FAIL", error=str(error))
finally:
    if host and host.poll() is None:
        try:
            report["diagnostics"] = http("/health")["events"]
            report["peerRoster"] = http("/peer/health")
        except Exception:
            pass
    if viewers: viewers.stop()
    if publisher: publisher.stop()
    if host and host.poll() is None:
        try:
            http("/stop", {}); host.wait(15)
        except Exception:
            subprocess.run(["taskkill", "/PID", str(host.pid), "/T", "/F"], capture_output=True); host.wait(10)
    report["sourceUnchanged"] = all(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest for path, digest in immutable.items())
    report["allProcessesReaped"] = not any(alive(pid) for pid in report.get("processes", {}).values())
    if not report["allProcessesReaped"]:
        report.update(result="FAIL", error="Owned process survived stop")
    Path(str(prefix) + "-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"result": report["result"], "error": report.get("error"), "evidence": str(prefix) + "-report.json"}))
    if report["result"] != "PASS_REAL_PEER_CEF" or not report["sourceUnchanged"]:
        sys.exit(1)
