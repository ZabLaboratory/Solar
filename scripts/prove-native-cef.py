"""Complete-scene qualification: Blue/native/Vision/Pulsar CEF, no broadcasting."""
import argparse
import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.parse
import urllib.request
sys.dont_write_bytecode = True
from PIL import Image
from proof.pulsar_cef import Pulsar

parser = argparse.ArgumentParser()
parser.add_argument("--pulsar", required=True)
parser.add_argument("--orion", required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True, help="Canonical UTC-stamped proof file prefix")
parser.add_argument("--local", default="http://127.0.0.1:8100")
parser.add_argument("--query-gateway", required=True)
parser.add_argument("--duration", type=int, default=180)
args = parser.parse_args()
prefix = Path(args.output)
prefix.parent.mkdir(parents=True, exist_ok=True)
source = Path(args.source)
original = json.loads(source.read_text(encoding="utf-8"))
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
archive = source.with_suffix(".lsmlz")
archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
orion_prefix = Path(args.orion) / "evidence/local-20261005-consolidation/forge" / prefix.name
frames = []
report = {"result": "RUNNING", "sceneId": original["scene_id"],
          "sceneVersion": original["scene_version"], "broadcast": False,
          "sourceValidation": "Complete published scene bytes; animation variants RAM-only; published Blue program pinned separately"}
solar_root = Path(__file__).resolve().parent.parent
host_artifacts = [solar_root / "dist/host/index.html", *sorted((solar_root / "dist/host/assets").glob("*.js"))]
report["runtimeArtifacts"] = {
    "vision": json.loads((solar_root / "public/vision/vision-assets.json").read_text(encoding="utf-8")),
    "host": {str(path.relative_to(solar_root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in host_artifacts},
    "native": json.loads((solar_root / "dist/native/manifest.json").read_text(encoding="utf-8")),
}

def local(path, value=None):
    request = urllib.request.Request(args.local + path, data=None if value is None else json.dumps(value).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

def phase(category, name):
    env = {**os.environ, "ORION_TEST_LSDP_NATIVE_ADDRESS": local("/health")["nativeAddress"],
           "ORION_TEST_LSML_PATH": str(source), "ORION_TEST_QUERY_GATEWAY": args.query_gateway}
    if category == "animation":
        package, test, key = "./internal/lsdpreception", "TestRealNativeBlueAnimation", "ORION_TEST_ANIMATION_PHASE"
    elif category == "operator":
        package, test, key = "./internal/api", "TestRealNativeOperatorVisual", "ORION_TEST_OPERATOR_PHASE"
    else:
        package, test, key = "./internal/lsdpreception", "TestRealNativeVisual", "ORION_TEST_NATIVE_PHASE"
    env[key] = name
    result = subprocess.run(["go", "test", "-v", "-count=1", "-run", "^" + test + "$", package],
                            cwd=args.orion, env=env, capture_output=True, text=True, encoding="utf-8", timeout=70)
    Path(str(orion_prefix) + "-" + category + "-" + name + ".log").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode or "--- PASS: " + test not in result.stdout:
        raise RuntimeError("Actual Orion phase failed: " + category + "/" + name + " " + result.stdout[-1600:])
    print("NATIVE_PHASE", category, name, flush=True)
    marker = "REAL_OPERATOR_NATIVE_PROOF "
    line = next((line.split(marker, 1)[1] for line in result.stdout.splitlines() if marker in line), None)
    return json.loads(line) if line else None

def pixel(image, x, y):
    return image.getpixel((x, y))[:3]

def camera_colors(image):
    return len({pixel(image, x, y) for y in range(30, 258, 4) for x in range(30, 444, 4)})

def difference(first, second, excluded):
    a, b = first.tobytes(), second.tobytes()
    compared = changed = 0
    for y in range(1080):
        for x in range(1920):
            if any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in excluded):
                continue
            offset = (y * 1920 + x) * 4
            compared += 1
            changed += a[offset:offset+4] != b[offset:offset+4]
    return {"comparedPixels": compared, "differentPixels": changed}

pulsar = Pulsar(args.pulsar, prefix)
async def capture(name, predicate, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        data = await pulsar.screenshot()
        image = Image.open(io.BytesIO(data)).convert("RGBA")
        if image.size == (1920, 1080) and image.getchannel("A").getextrema() == (255, 255) and predicate(image):
            path = Path(str(prefix) + "-" + name + ".png")
            path.write_bytes(data)
            frames.append({"name": name, "path": str(path), "sha256": hashlib.sha256(data).hexdigest(),
                           "cameraColors": camera_colors(image), "opaque": True})
            print("CEF_FRAME", name, "camera_colors=" + str(camera_colors(image)), flush=True)
            return image
        await asyncio.sleep(0.15)
    raise RuntimeError("Expected complete CEF frame absent: " + name)

def url(resource, selector=None):
    health = local("/health")
    query = {"lsdp": health["native"], "resource": resource}
    if selector: query["selector"] = selector
    return args.local + "/host.html?" + urllib.parse.urlencode(query)

async def run():
    await pulsar.connect()
    kinds = await pulsar.request("GetInputKindList")
    if "browser_source" not in kinds["inputKinds"]: raise RuntimeError("CEF browser_source missing")
    await asyncio.to_thread(phase, "animation", "seed")
    await pulsar.show(url("solar/program"))
    before = await capture("before", lambda i: pixel(i,500,100) == (43,42,42) and camera_colors(i) > 80)
    baseline_anchors = [pixel(before,*p) for p in [(10,10),(500,900),(1700,700),(1700,1000),(460,10)]]
    def preserved(image):
        return [pixel(image,*p) for p in [(10,10),(500,900),(1700,700),(1700,1000),(460,10)]] == baseline_anchors and camera_colors(image) > 80
    await asyncio.to_thread(phase, "animation", "hide")
    hidden = await capture("hide", lambda i: pixel(i,500,100) == (103,103,103) and preserved(i))
    document = local("/state?resource=solar/program")["state"]
    document["layout"]["children"][0]["position"]["x"] = 121
    report["structuralReceipt"] = local("/lsml?resource=solar/program", document)
    hold = await capture("hold-after-structure", lambda i: pixel(i,500,100) == (103,103,103) and preserved(i))
    await asyncio.to_thread(phase, "animation", "reveal")
    reveal = await capture("reveal", lambda i: pixel(i,500,100) == (43,42,42) and preserved(i))
    await asyncio.to_thread(phase, "animation", "move")
    moved = await capture("move", lambda i: pixel(i,500,100) == (103,103,103) and pixel(i,550,100) == (43,42,42) and preserved(i))
    camera, panel, moved_union = (24,24,450,264), (473,24,1596,666), (473,24,1636,666)
    static_checks = {
        "restored": difference(before,reveal,[camera]),
        "hideOthers": difference(before,hidden,[camera,panel]),
        "holdFrame": difference(hidden,hold,[camera]),
        "moveOthers": difference(before,moved,[camera,moved_union]),
    }
    if any(value["differentPixels"] for value in static_checks.values()):
        raise RuntimeError("Static scene incomplete: " + json.dumps(static_checks))
    rich_colors = len(before.crop(panel).getcolors(1123*642))
    if rich_colors < 1000: raise RuntimeError("Full portraits/text/assets absent")
    report["staticChecks"], report["panelDistinctColors"] = static_checks, rich_colors
    await asyncio.to_thread(phase,"surface","seed")
    selector = hashlib.sha256((original["scene_id"] + "\0" + original["scene_version"]).encode()).hexdigest()
    await pulsar.show(url("solar/generations", selector))
    base = await capture("operator-before", lambda i: camera_colors(i) > 80 and pixel(i,500,640) == pixel(before,500,640))
    camera_before = sum(e.get("type") == "camera" for e in local("/health")["events"])
    commands = []
    for name in ("LEC","LCK"):
        ids = {e.get("transactionId") for e in local("/health")["events"]}
        command = await asyncio.to_thread(phase,"operator",name)
        observation = None
        for _ in range(100):
            observation = next((e for e in reversed(local("/health")["events"]) if e.get("type") == "applied" and
                e.get("transactionId") not in ids and e.get("projection",{}).get("runtime_instance_id") == "cef-operator-" + name), None)
            if observation: break
            await asyncio.sleep(0.2)
        if not observation: raise RuntimeError("Missing Solar submitted operator frame: " + name)
        await asyncio.sleep(2)
        image = await capture(name, lambda i: camera_colors(i)>80)
        changed = sum(pixel(image,x,y) != pixel(base,x,y) for y in range(120,590,3) for x in range(500,1570,3))
        if changed < 300: raise RuntimeError("Player area unchanged: " + name)
        for point in [(500,640),(1500,620),(1000,900)]:
            if pixel(image,*point) != pixel(base,*point): raise RuntimeError("Operator damaged static surface")
        commands.append({"entrypoint":name,"operator":command,"solarSubmission":observation,"changedPlayerPixels":changed})
    if commands[0]["operator"]["names"] == commands[1]["operator"]["names"]: raise RuntimeError("LEC/LCK rosters identical")
    report["operatorCommands"] = commands
    camera_after = sum(e.get("type") == "camera" for e in local("/health")["events"])
    if camera_before != camera_after: raise RuntimeError("Camera reopened during operator commands")
    report["cameraNotReopenedOnOperator"] = True
    await asyncio.to_thread(phase,"surface","restore")
    await pulsar.show(url("solar/program"))
    local("/lsml?resource=solar/program",original)
    await capture("restored", lambda i: pixel(i,500,100) == (43,42,42) and camera_colors(i)>80)
    initial_stats = await pulsar.request("GetStats")
    camera_before = sum(e.get("type") == "camera" for e in local("/health")["events"])
    latencies, samples = [], []
    start = time.monotonic()
    count = 0
    while time.monotonic() - start < args.duration:
        count += 1
        started = time.monotonic()
        # Full LSML sends are diffed in Rust; only an unrelated default changes.
        desired = json.loads(json.dumps(original))
        desired.setdefault("defaults",{})["__proof.sequence"] = count
        receipt = await asyncio.to_thread(local,"/lsml?resource=solar/program",desired)
        latencies.append((time.monotonic()-started)*1000)
        if receipt["receipt"].get("status") != "completed": raise RuntimeError("Native endurance delivery failed")
        image = await capture("endurance-last", lambda i: pixel(i,500,100) == (43,42,42) and camera_colors(i)>80)
        if count % 6 == 0:
            stats = await pulsar.request("GetStats")
            samples.append(stats)
            print("ENDURANCE", round(time.monotonic()-start), "s", "deliveries=" + str(count), "fps=" + str(stats.get("activeFps")), flush=True)
        await asyncio.sleep(5)
    final_stats = await pulsar.request("GetStats")
    sorted_ms = sorted(latencies)
    def percentile(fraction): return sorted_ms[min(len(sorted_ms)-1,int((len(sorted_ms)-1)*fraction))]
    rendered = final_stats.get("renderTotalFrames",0) - initial_stats.get("renderTotalFrames",0)
    skipped = final_stats.get("renderSkippedFrames",0) - initial_stats.get("renderSkippedFrames",0)
    report["endurance"] = {"seconds":time.monotonic()-start,"deliveries":count,
        "receiptMs":{"p50":percentile(.5),"p95":percentile(.95),"p99":percentile(.99)},
        "boundary":"Full-LSML local POST to native destination receipt; not physical display latency",
        "renderFrames":rendered,"renderSkippedFrames":skipped,"samples":samples,"finalStats":final_stats,
        "dropRatio":skipped/max(1,rendered)}
    if rendered < args.duration * 40 or skipped/max(1,rendered) > .05: raise RuntimeError("Endurance render/frame-drop threshold failed")
    if any(e.get("type")=="error" for e in local("/health")["events"]): raise RuntimeError("Solar runtime errors")
    report["endurance"]["cameraNotReopened"] = camera_before == sum(e.get("type")=="camera" for e in local("/health")["events"])
    if not report["endurance"]["cameraNotReopened"]: raise RuntimeError("Endurance camera reopened")
    report["frames"] = frames

try:
    pulsar.start()
    asyncio.run(run())
    report["result"] = "PASS"
except Exception as error:
    report["result"] = "FAIL"
    report["error"] = str(error)
    raise
finally:
    try: local("/lsml?resource=solar/program",original)
    finally:
        pulsar.stop()
        report["sourceUnchanged"] = source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
        report["archiveUnchanged"] = archive_hash == hashlib.sha256(archive.read_bytes()).hexdigest()
        report["pulsarReaped"] = pulsar.process is None or pulsar.process.poll() is not None
        Path(str(prefix) + "-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
