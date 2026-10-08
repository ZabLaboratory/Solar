"""Read actual owned CEF capabilities; this diagnostic is not a scene proof."""
import argparse
import asyncio
import json
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pulsar_cef import Pulsar

parser = argparse.ArgumentParser()
parser.add_argument("--pulsar", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
prefix = Path(args.output).resolve()
prefix.parent.mkdir(parents=True, exist_ok=True)
received = threading.Event()
result = {}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        page = b"""<!doctype html><script>
        (async()=>{
          const canvas=document.createElement('canvas');
          const gl=canvas.getContext('webgl2');
          const ext=gl?.getExtension('WEBGL_debug_renderer_info');
          let adapter, adapterError;
          try { adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}); }
          catch(error) { adapterError=String(error); }
          const value={userAgent:navigator.userAgent,webgpu:!!navigator.gpu,
            gpuAdapter:!!adapter,adapterInfo:adapter?.info,adapterError,
            webglRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
            webglVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,
            renderer:gl?.getParameter(gl.RENDERER),version:gl?.getParameter(gl.VERSION)};
          await fetch('/result',{method:'POST',body:JSON.stringify(value)});
        })();</script>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(page)

    def do_POST(self):
        result.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        received.set()
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
pulsar = Pulsar(args.pulsar, prefix)


async def run():
    pulsar.start()
    try:
        await pulsar.connect()
        await pulsar.show(f"http://127.0.0.1:{server.server_port}/")
        for _ in range(100):
            if received.is_set():
                break
            await asyncio.sleep(.1)
        if not received.is_set():
            raise RuntimeError("CEF did not report its capabilities")
        Path(str(prefix) + "-cef-capabilities.json").write_text(
            json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result))
    finally:
        pulsar.stop()
        server.shutdown()


asyncio.run(run())
