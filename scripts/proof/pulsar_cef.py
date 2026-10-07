"""Actual Pulsar process and obs-websocket v5 capture. No broadcast commands."""
import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import threading
import websockets

class Pulsar:
    def __init__(self, executable, output):
        self.executable = Path(executable)
        self.prefix = Path(output)
        self.output = self.prefix.parent
        self.password = secrets.token_urlsafe(24)
        self.ready = threading.Event()
        self.endpoint = None
        self.lines = []
        self.serial = 0
        self.process = None
        self.fps = int(os.environ.get("SOLAR_PROOF_CEF_FPS", "60"))
        self.capture_fps = int(os.environ.get("SOLAR_PROOF_CAPTURE_FPS", str(self.fps)))
        if self.fps not in (60, 120):
            raise ValueError("Proof capture FPS must be 60 or 120")
        if self.capture_fps not in (60, 120):
            raise ValueError("Proof recording FPS must be 60 or 120")

    def start(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = {**os.environ, "PULSAR_PORT": str(port), "PULSAR_PASSWORD": self.password,
               "PULSAR_FPS": str(self.capture_fps), "PULSAR_RESOLUTION": "1920x1080",
               "PULSAR_RECORD_DIR": str(self.output)}
        env.pop("PULSAR_CAPTURE_WINDOW", None)
        env.pop("PULSAR_MIC_DEVICE_ID", None)
        arguments = [str(self.executable), "--no-sandbox", "--enable-webgl",
                     "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream"]
        if os.environ.get("SOLAR_PROOF_WEBGPU") == "1":
            arguments.append("--enable-unsafe-webgpu")
        self.process = subprocess.Popen(
            arguments,
            cwd=self.executable.parent, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace",
            creationflags=0x08000000 if os.name == "nt" else 0)
        def read():
            for line in self.process.stdout:
                match = re.match(r"PULSAR_READY ws=(\S+) password=(\S+)", line)
                if match:
                    self.endpoint = match.group(1)
                    self.ready.set()
                self.lines.append(line.replace(self.password, "<redacted>"))
                self.lines = self.lines[-120:]
        threading.Thread(target=read, daemon=True).start()
        if not self.ready.wait(45):
            raise RuntimeError("Pulsar did not become ready: " + "".join(self.lines[-15:]))

    async def connect(self):
        self.ws = await websockets.connect(self.endpoint, subprotocols=["obswebsocket.json"],
                                           max_size=2**24, ping_interval=None)
        hello = json.loads(await asyncio.wait_for(self.ws.recv(), 10))
        identify = {"rpcVersion": hello["d"]["rpcVersion"], "eventSubscriptions": 0}
        if "authentication" in hello["d"]:
            challenge = hello["d"]["authentication"]
            secret = base64.b64encode(hashlib.sha256((self.password + challenge["salt"]).encode()).digest()).decode()
            identify["authentication"] = base64.b64encode(hashlib.sha256((secret + challenge["challenge"]).encode()).digest()).decode()
        await self.ws.send(json.dumps({"op": 1, "d": identify}))
        if json.loads(await asyncio.wait_for(self.ws.recv(), 10)).get("op") != 2:
            raise RuntimeError("Pulsar authentication failed")

    async def request(self, kind, data=None):
        self.serial += 1
        request_id = str(self.serial)
        await self.ws.send(json.dumps({"op": 6, "d": {"requestType": kind,
            "requestId": request_id, "requestData": data or {}}}))
        async def receive():
            while True:
                message = json.loads(await self.ws.recv())
                if message.get("op") == 7 and message["d"]["requestId"] == request_id:
                    result = message["d"]
                    if not result["requestStatus"]["result"]:
                        raise RuntimeError("Pulsar request rejected: " + kind)
                    return result.get("responseData", {})
        return await asyncio.wait_for(receive(), 20)

    async def show(self, url):
        response = await self.request("CallVendorRequest", {"vendorName": "pulsar-scene",
            "requestType": "SetCaptureSource", "requestData": {"kind": "browser_source",
            "url": url, "width": 1920, "height": 1080, "fps": self.fps, "reroute_audio": True}})
        if response.get("responseData", {}).get("kind") != "browser_source":
            raise RuntimeError("Actual CEF source unavailable")

    async def screenshot(self):
        response = await self.request("GetSourceScreenshot", {"sourceName": "PulsarSceneSource",
            "imageFormat": "png", "imageWidth": 1920, "imageHeight": 1080})
        return base64.b64decode(response["imageData"].split(",", 1)[-1])

    def stop(self):
        if self.process and self.process.poll() is None:
            # Reap only the process tree created by this proof.
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                               capture_output=True, timeout=10)
            else:
                self.process.terminate()
            self.process.wait(timeout=10)
        Path(str(self.prefix) + "-pulsar.log").write_text("".join(self.lines), encoding="utf-8")
