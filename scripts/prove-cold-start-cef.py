"""Two real process lifecycles with immutable cache, signed test capsules and CEF.

This proves the local cache/runtime boundary, not authenticated Canvas acquisition.
The separate authenticated probe must pass before claiming the complete chain.
"""
import argparse
import asyncio
import base64
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
from PIL import Image
from proof.pulsar_cef import Pulsar

parser = argparse.ArgumentParser(description=__doc__)
for name in ["pulsar", "orion", "source", "output"]:
    parser.add_argument("--" + name, required=True)
parser.add_argument("--camera", default="PC-LM1E Camera (0458:6006)")
parser.add_argument("--capsule")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
prefix = Path(args.output).resolve()
prefix.parent.mkdir(parents=True, exist_ok=True)
storage = root / "build" / (prefix.name + "-cache")
orion_storage = Path(args.orion) / "build" / (prefix.name + "-cache")
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
origin = "http://127.0.0.1:" + str(port)
source = Path(args.source)
original_hashes = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                   for path in [source, source.with_suffix(".lsmlz")]}
report = {"result": "RUNNING", "boundary": "complete existing scene; local cache-contract manifest and test signatures; no fresh Canvas admission",
          "broadcast": False, "mutatedLSMLSaved": False, "phases": [], "commands": [], "frames": []}
host = None
pulsar = None
if args.capsule:
    report["boundary"] = "complete scene admitted and signed by actual local Canvas; real gateway identity and Blue compilation; producer capsule; local signing key"
    report["canvasCapsuleSHA256"] = hashlib.sha256(Path(args.capsule).read_bytes()).hexdigest()


def runtime_artifacts():
    paths = {"orion/executable": Path(args.orion) / "build/orion-consolidated.exe",
             "pulsar/executable": Path(args.pulsar),
             "proof/host": root / "scripts/proof/cold-start-host.mjs",
             "proof/driver": Path(__file__).resolve()}
    paths.update({"solar/dist/" + path.relative_to(root / "dist").as_posix(): path
                  for path in (root / "dist").rglob("*") if path.is_file()})
    return {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sorted(paths.items())}


report["runtimeArtifacts"] = runtime_artifacts()


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


def start_host(phase, offline):
    command = ["node", str(root / "scripts/proof/cold-start-host.mjs"), "--scene", str(source.with_suffix(".lsmlz")),
               "--orion", args.orion, "--storage", str(storage), "--orion-storage", str(orion_storage),
               "--output", str(Path(args.orion) / prefix.parent.relative_to(root) / (prefix.name + "-" + phase)),
               "--port", str(port), "--camera", args.camera]
    if offline:
        command.append("--offline")
    if args.capsule:
        command.extend(["--capsule", args.capsule])
    process = subprocess.Popen(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", creationflags=0x08000000)
    ready = threading.Event()
    lines = []
    def reader():
        with Path(str(prefix) + "-" + phase + "-host.log").open("w", encoding="utf-8") as output:
            for line in process.stdout:
                lines.append(line)
                output.write(line)
                output.flush()
                if '"ready":true' in line:
                    ready.set()
    threading.Thread(target=reader, daemon=True).start()
    if not ready.wait(25):
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
        process.wait(10)
        raise RuntimeError("Host not ready: " + "".join(lines[-8:]))
    return process


async def wait_active():
    until = time.monotonic() + 45
    last = None
    while time.monotonic() < until:
        last = http("/state")["state"].get("scene_control", {}).get("defaults", {}).get("observed", {})
        if all(last.get(lane, {}).get("status") == "active" for lane in ["program", "preview"]):
            return last
        if any(value.get("status") == "failed" for value in last.values()):
            raise RuntimeError("Selection failed: " + json.dumps(last))
        await asyncio.sleep(.2)
    raise RuntimeError("Selection timed out: " + json.dumps(last))


async def capture(phase, lane):
    input_name = "PulsarSceneSource" if lane == "program" else "SolarPreviewProof"
    until = time.monotonic() + 12
    while time.monotonic() < until:
        response = await pulsar.request("GetSourceScreenshot", {"sourceName": input_name, "imageFormat": "png", "imageWidth": 1920, "imageHeight": 1080})
        data = base64.b64decode(response["imageData"].split(",", 1)[-1])
        image = Image.open(io.BytesIO(data)).convert("RGBA")
        pixel = lambda x, y: image.getpixel((x, y))[:3]
        colors = len({pixel(x, y) for y in range(30, 258, 4) for x in range(30, 444, 4)})
        if image.getchannel("A").getextrema() == (255, 255) and pixel(500, 100) == (43, 42, 42) and pixel(1700, 700) == (0, 0, 0) and pixel(200, 600) == (0, 0, 0) and colors > 80:
            path = Path(str(prefix) + "-" + phase + "-" + lane + ".png")
            path.write_bytes(data)
            report["frames"].append({"phase": phase, "lane": lane, "path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "cameraColors": colors})
            print("COLD_CEF", phase, lane, flush=True)
            return
        await asyncio.sleep(.15)
    raise RuntimeError("Complete scene/camera absent: " + phase + "/" + lane)


def persistent_snapshot():
    capsules = sorted((storage / "sources").glob("*"))
    if len(capsules) != 1:
        raise RuntimeError("Expected one exact immutable source cache capsule")
    result = {"sourceCapsuleSHA256": hashlib.sha256(capsules[0].read_bytes()).hexdigest(),
              "selectionSHA256": hashlib.sha256((orion_storage / "selection.lsml").read_bytes()).hexdigest(), "catalog": []}
    for path in sorted((orion_storage / "catalog").glob("*.json")):
        entry = json.loads(path.read_text(encoding="utf-8"))
        intent = entry["intent"]
        original = json.loads(base64.b64decode(intent["lsml_bundle"]))
        if "cold_proof_runtime_only" in original.get("defaults", {}):
            raise RuntimeError("Mutated LSML was persisted in Orion's capsule")
        result["catalog"].append({"action": entry["action"], "programDigest": intent["blue_program_digest"],
                                  "sourceDigest": intent["lsml_bundle_digest"], "manifest": intent["blue_manifest"]})
    if len(result["catalog"]) != 2:
        raise RuntimeError("Missing admitted Program/Preview capsule")
    return result


async def run_phase(phase, offline):
    global host, pulsar
    host = start_host(phase, offline)
    initial = http("/health")
    pulsar = Pulsar(args.pulsar, Path(str(prefix) + "-" + phase))
    pulsar.start()
    await pulsar.connect()
    def url(lane):
        return origin + "/host.html?" + urllib.parse.urlencode({"lsdp": initial["native"], "resource": "solar/" + lane})
    await pulsar.show(url("program"))
    current = await pulsar.request("GetCurrentProgramScene")
    await pulsar.request("CreateInput", {"sceneName": current["currentProgramSceneName"], "inputName": "SolarPreviewProof", "inputKind": "browser_source",
        "inputSettings": {"url": url("preview"), "width": 1920, "height": 1080, "fps": 60, "shutdown": False}, "sceneItemEnabled": True})
    if not offline:
        http("/select", {})
    observed = await wait_active()
    for lane in ["program", "preview"]:
        state = http("/state?resource=solar/" + lane)["state"]
        if state["scene_version"] != initial["sceneVersion"] or state["x-orion-artifact-set"] != initial["artifactSet"]:
            raise RuntimeError("Source/artifact identity conflated")
        if offline and "cold_proof_runtime_only" in state.get("defaults", {}):
            raise RuntimeError("Live state survived cold reconstruction")
        await capture(phase, lane)
        if offline:
            contracts = http("/contracts?lane=" + lane)
            if contracts["status"] != 200 or not contracts["body"]["triggers"]:
                raise RuntimeError("Operator declarations not restored: " + json.dumps(contracts))
            commands = contracts["body"]["triggers"]
            declared = (json.loads(base64.b64decode(json.loads(Path(args.capsule).read_text(encoding="utf-8"))["envelope"]["blue_program"]))
                        if args.capsule else json.loads((Path(args.orion) / "internal/api/testdata/scene-lec-lck.program.json").read_text(encoding="utf-8")))["entrypoints"]
            if sorted(command["entrypoint_id"] for command in commands) != sorted(entry["id"] for entry in declared if entry["kind"] == "call"):
                raise RuntimeError("Incomplete command discovery")
            for command in commands:
                widget = (command.get("ui") or {}).get("widget", "")
                if widget not in ["", "match-selector"]:
                    raise RuntimeError("No test input for declared widget " + widget)
                payload = {"match_id": "opaque-offline-operator-selection"} if widget else None
                response = http("/call?lane=" + lane, {"blueprint": command["blueprint_id"], "entrypoint": command["entrypoint_id"], "payload": payload})
                if response["status"] != 202 or response["body"].get("status") != "fired" or "execution" not in response["body"]:
                    raise RuntimeError("Command dispatch failed: " + json.dumps(response))
                report["commands"].append({"lane": lane, "entrypoint": command["entrypoint_id"], "response": response["body"], "externalEffect": "no successful remote effect claimed while offline"})
    if not offline:
        for lane in ["program", "preview"]:
            http("/runtime-mutation?lane=" + lane, {})
            if http("/state?resource=solar/" + lane)["state"]["defaults"].get("cold_proof_runtime_only") is None:
                raise RuntimeError("Runtime-only mutation not applied")
    await asyncio.sleep(2)
    final = http("/health")
    if offline and final["upstreamSourceReads"] != 0:
        raise RuntimeError("Offline source called upstream")
    if any(event.get("type") == "error" for event in final["events"]):
        raise RuntimeError("Renderer failed: " + json.dumps([event for event in final["events"] if event.get("type") == "error"]))
    disk = persistent_snapshot()
    pids = {"host": host.pid, "orion": final["orionPid"], "native": final["nativePid"], "pulsar": pulsar.process.pid}
    await pulsar.ws.close()
    pulsar.stop()
    http("/stop", {})
    host.wait(15)
    if any(alive(pid) for pid in pids.values()):
        raise RuntimeError("Owned process survived full stop")
    execution = {}
    if offline:
        log = (Path(args.orion) / prefix.relative_to(root).parent / (prefix.name + "-" + phase + "-orion.log")).read_text(encoding="utf-8")
        execution = {"dispatches": log.count('"msg":"engine b operator dispatch returned"'),
                     "remoteQueryErrors": log.count('"msg":"engine b db query failed"'),
                     "remoteErrorCode": "DB_QUERY_FAILED", "externalSuccessClaimed": False}
        if execution["dispatches"] != len(report["commands"]) or execution["remoteQueryErrors"] < len(report["commands"]):
            raise RuntimeError("Missing dispatch/error diagnostics while offline")
    report["phases"].append({"phase": phase, "pids": pids, "allProcessesReaped": True, "observed": observed, "disk": disk, "stats": final, "execution": execution})
    host = None
    pulsar = None


try:
    asyncio.run(run_phase("warm", False))
    asyncio.run(run_phase("cold-offline", True))
    before, after = report["phases"]
    if before["disk"] != after["disk"]:
        raise RuntimeError("Immutable sources/Blue declarations/desired selection changed")
    for name in before["pids"]:
        if before["pids"][name] == after["pids"][name]:
            raise RuntimeError("Process not replaced: " + name)
    if runtime_artifacts() != report["runtimeArtifacts"]:
        raise RuntimeError("Runtime artifact changed during proof")
    if not all(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest for path, digest in original_hashes.items()):
        raise RuntimeError("Original source was changed")
    report["result"] = "PASS_LOCAL_COLD_START"
except Exception as error:
    report["result"] = "FAIL"
    report["error"] = str(error)
    raise
finally:
    if pulsar:
        pulsar.stop()
    if host and host.poll() is None:
        try:
            http("/stop", {})
            host.wait(15)
        except Exception:
            subprocess.run(["taskkill", "/PID", str(host.pid), "/T", "/F"], capture_output=True)
            host.wait(10)
    report["sourceUnchanged"] = all(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest for path, digest in original_hashes.items())
    Path(str(prefix) + "-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
