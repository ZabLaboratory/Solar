"""Reconcile existing local proofs; never start, publish or modify a runtime."""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--orion", required=True)
parser.add_argument("--canvas", required=True)
parser.add_argument("--pulsar", required=True)
parser.add_argument("--output", required=True, help="Canonical evidence prefix inside this Solar worktree")
args = parser.parse_args()
solar = Path(__file__).resolve().parent.parent
orion, canvas = Path(args.orion).resolve(), Path(args.canvas).resolve()
prefix = Path(args.output).resolve()
relative = Path("evidence/local-20261005-final-certification/forge")
assert prefix.parent == solar / relative
se, oe, ce = solar / relative, orion / relative, canvas / relative
proofs = []


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def latest(root, pattern):
    paths = sorted(root.glob(pattern))
    assert paths, "Missing proof: " + pattern
    path = paths[-1]
    proofs.append(path)
    return path


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments], stderr=subprocess.DEVNULL)


def snapshot(expected):
    root = Path(expected["root"])
    return {
        "root": expected["root"],
        "head": git(root, "rev-parse", "HEAD").decode().strip(),
        "branch": git(root, "branch", "--show-current").decode().strip(),
        "status": git(root, "status", "--porcelain=v1").decode(),
        "trackedDiffSHA256": hashlib.sha256(git(root, "diff", "--binary", "HEAD")).hexdigest(),
        "untracked": {name: sha(root / name) for name in
                      git(root, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0") if name},
    }


baseline_path = se / "20261005T115108Z-baseline.json"
baseline = read(baseline_path)
preserved = {}
for name in ["Prism", "Lumencast"]:
    expected = baseline["repositories"][name]
    current = snapshot(expected)
    assert current == expected, name + " changed since baseline"
    preserved[name] = {"result": "PASS", "head": current["head"], "branch": current["branch"],
                       "trackedDiffSHA256": current["trackedDiffSHA256"], "untrackedFiles": len(current["untracked"])}
for name, root in [("Solar", solar), ("Orion", orion), ("ZabCanvas", canvas)]:
    expected = baseline["repositories"][name]
    assert git(root, "rev-parse", "HEAD").decode().strip() == expected["head"]
    assert git(root, "branch", "--show-current").decode().strip() == expected["branch"]
    assert Path(git(root, "rev-parse", "--show-toplevel").decode().strip()) == root

cold_path = latest(se, "*-canvas-cold-report.json")
cold = read(cold_path)
assert cold["result"] == "PASS_LOCAL_COLD_START" and cold["sourceUnchanged"]
assert not cold["mutatedLSMLSaved"] and not cold["broadcast"]
assert len(cold["phases"]) == 2 and len(cold["frames"]) == 4
warm, offline = cold["phases"]
assert warm["disk"] == offline["disk"] and offline["stats"]["upstreamSourceReads"] == 0
assert all(phase["allProcessesReaped"] for phase in cold["phases"])
assert all(warm["pids"][name] != offline["pids"][name] for name in warm["pids"])
producer_path = ce / cold_path.name.replace("-canvas-cold-report.json", "-actual-vision-report.json")
producer = read(producer_path)
proofs.append(producer_path)
assert producer["result"] == "PASS_ACTUAL_CANVAS_VISION_ADMISSION"
assert not producer["seededValidation"] and not producer["renderBundleRequired"]
assert producer["assets"] == 7 and producer["bindingClosure"]
artifacts = Path(producer["producerArtifacts"])
assert sha(artifacts / "capsule.json") == cold["canvasCapsuleSHA256"]
assert sha(artifacts / "scene.lsmlz") == producer["archiveSHA256"]
capsule = read(artifacts / "capsule.json")["envelope"]
assert capsule["blue_manifest"]["readiness"]["offline_ready"]
assert capsule["blue_manifest"]["scene_version"] == producer["sourceVersion"]
program = json.loads(base64.b64decode(capsule["blue_program"]))
calls = sorted(entry["id"] for entry in program["entrypoints"] if entry["kind"] == "call")
for lane in ["program", "preview"]:
    assert sorted(call["entrypoint"] for call in cold["commands"] if call["lane"] == lane) == calls
assert offline["execution"]["dispatches"] == len(cold["commands"])
assert offline["execution"]["remoteQueryErrors"] >= len(cold["commands"])
assert not offline["execution"]["externalSuccessClaimed"]
for name, digest in cold["runtimeArtifacts"].items():
    path = {"orion/executable": orion / "build/orion-consolidated.exe", "pulsar/executable": Path(args.pulsar),
            "proof/host": solar / "scripts/proof/cold-start-host.mjs",
            "proof/driver": solar / "scripts/prove-cold-start-cef.py"}.get(name)
    if name.startswith("solar/dist/"):
        path = solar / name.removeprefix("solar/")
    assert path is not None and sha(path) == digest, "Runtime drift: " + name

peer_path = latest(se, "*-final-peer-camera-report.json")
peer = read(peer_path)
assert peer["result"] == "PASS_REAL_PEER_CEF" and peer["sourceUnchanged"] and peer["allProcessesReaped"]
assert len(peer["frames"]) == 10 and not peer["mutatedLSMLSaved"] and not peer["broadcast"]
for frame in cold["frames"] + peer["frames"]:
    assert sha(frame["path"]) == frame["sha256"]
    proofs.append(Path(frame["path"]))

unit_path = latest(se, "*-final-solar-tests.json")
unit = read(unit_path)
assert unit["success"] and unit["numFailedTests"] == 0
race_path = latest(oe, "*-race.jsonl")
events = [json.loads(line) for line in race_path.read_text(encoding="utf-8-sig").splitlines()
          if line.startswith("{")]
assert not any(event["Action"] == "fail" for event in events)
go_counts = {"testsAndSubtests": sum(event["Action"] == "pass" and "Test" in event for event in events),
             "packages": sum(event["Action"] == "pass" and "Test" not in event for event in events),
             "skips": [event["Test"] for event in events if event["Action"] == "skip" and "Test" in event]}
assert go_counts["packages"] == 22
assert any(event["Action"] == "pass" and event.get("Test") ==
           "TestOperatorExecutionDiscoversEveryCommandAcrossScopes" for event in events)
canvas_tests = latest(ce, "*-final-canvas-tests.log")
test_log = canvas_tests.read_text(encoding="utf-8-sig")
match = re.search(r"(\d+) passed, (\d+) skipped", test_log)
assert match and " failed" not in test_log
for pattern in ["*-final-canvas-all-lint.log", "*-final-canvas-types.log"]:
    text = latest(ce, pattern).read_text(encoding="utf-8-sig")
    assert "All checks passed!" in text or "Success: no issues found" in text

native_path = latest(se, "*-release-producers.log")
native_text = native_path.read_text(encoding="utf-8-sig")
native_tests = ["TestRealNativeProducers", "TestRealSharedNative",
                "TestRealNativeTransportRecovery", "TestRealNativeBlueStructuralMutation"]
for name in native_tests:
    assert "--- PASS: " + name + " " in native_text
assert json.loads(native_text.splitlines()[-1])["originalUnchanged"]
native_owner_path = oe / (prefix.name + "-native-producers.log")
native_owner_path.write_text("\n".join(native_text.splitlines()[:-1]) + "\n", encoding="utf-8")
proofs.append(native_owner_path)
for pattern in ["*-release-recovery.log", "*-final-release-installed.log"]:
    receipt = json.loads(latest(se, pattern).read_text(encoding="utf-8-sig").splitlines()[-1])
    assert receipt["result"] == "PASS"
installed = read(latest(se, "*-final-npm-install-report.json"))
assert installed["result"] == "PASS_NPM_INSTALL"
for name, digest in installed["distHashes"].items():
    assert sha(solar / "dist" / name) == digest
    assert sha(Path(installed["installedRoot"]) / "dist" / name) == digest
postinstall_path = se / latest(se, "*-final-npm-install-report.json").name.replace("-report.json", ".log")
proofs.append(postinstall_path)
assert "> node scripts/patch-lumencast-protocol.mjs" in postinstall_path.read_text(encoding="utf-8-sig")
manifest = read(solar / "dist/native/manifest.json")
binary = solar / "dist/native" / manifest["binaries"]["win32-x64"]["file"]
assert sha(binary) == manifest["binaries"]["win32-x64"]["sha256"]
assert manifest["source_revision"] == baseline["repositories"]["Lumencast"]["head"]

remote_path = latest(se, "*-deployed-canvas-report.json")
remote = read(remote_path)
assert remote["reference"]["signatureVerified"]
assert remote["brokerBoundary"]["operatorDereferenceDenied"]
assert remote["boundaries"] == ["CANVAS_SOURCE_HTTP_404"]
latest(se, "*-final-solar-checks.log")
for pattern in ["*-final-go-vet.log", "*-final-staticcheck.log", "*-final-go-build-report.json"]:
    latest(oe, pattern)
for pattern in ["*-postgres-boundary.log", "*-other-skips-boundary.log"]:
    latest(ce, pattern)
adapter_tests = latest(ce, "*-validation-adapter-tests.log").read_text(encoding="utf-8-sig")
assert " passed" in adapter_tests and " failed" not in adapter_tests
for owner in [solar, orion, canvas]:
    guard = latest(owner / relative, "*-final-size-guard.log").read_text(encoding="utf-8-sig")
    assert "no growth" in guard
historical_marker = orion / "evidence/local-20261005-coordinated-runtime/forge/20261005T104926Z-real-marker.log"
assert "--- PASS: TestRealMarkerRuleLaunchAndLSMLIntent" in historical_marker.read_text(encoding="utf-8-sig")
proofs.append(historical_marker)
historical_control = solar / "evidence/local-20261005-coordinated-runtime/forge/20261005T105635Z-final-control-cef-report.json"
assert read(historical_control)["result"] == "PASS"
proofs.append(historical_control)
proofs.append(baseline_path)

candidates = {}
for name, owner in [("Solar", solar), ("Orion", orion), ("ZabCanvas", canvas)]:
    names = git(owner, "ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")
    files = {name: sha(owner / name) for name in names if name and not name.startswith("evidence/")
             and (owner / name).is_file()}
    candidates[name] = {"head": git(owner, "rev-parse", "HEAD").decode().strip(),
                        "branch": git(owner, "branch", "--show-current").decode().strip(), "files": files}

report = {
    "stamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "result": "PASS_LOCAL_READY_FOR_PRISM_INTEGRATION",
    "authority": baseline["authority"], "producerAdmission": producer["result"],
    "candidates": candidates,
    "bluePreparation": {"sourceAssetsDeclarationsAndClosure": "PASS", "assets": producer["assets"],
                        "programDigest": producer["programDigest"], "validationAuthority": "ZabCanvas",
                        "executionAuthority": "Orion", "businessOracleInOrion": False},
    "coldStart": {"result": cold["result"], "commandsDiscovered": len(calls), "dispatches": len(cold["commands"]),
                  "frames": 4, "immutableCapsulesAndSelection": True, "liveLSMLPersisted": False,
                  "allProcessesReaped": True, "upstreamSourceReadsWhenOffline": 0},
    "cameras": {"result": peer["result"], "frames": 10, "allProcessesReaped": True,
                "transport": "loopback Meet/WebRTC, separate physical camera publisher, two CEF viewers"},
    "tests": {"solar": unit["numPassedTests"], "solarFiles": len(unit["testResults"]),
              "orionRace": go_counts, "nativeActualOptIns": native_tests,
              "canvasPassed": int(match[1]), "canvasSkipped": int(match[2]),
              "canvasWarning": "pre-existing duplicate OpenAPI operation ID on asset GET/HEAD",
              "finalValidationAdapterTests": adapter_tests.splitlines()[-1], "sizeGuards": "PASS_ALL_THREE"},
    "installedPackage": {"result": installed["result"], "files": installed["files"],
                         "nativeBuild": "release Windows x64", "nativeManifest": manifest},
    "preserved": preserved,
    "retainedIndependentProofs": {
        "Marker": "historical actual process/window/native ACK/persisted intent/off proof; not a fresh rerun",
        "sceneCompensation": "historical 11-frame CEF scenario; current runtime tests retained",
    },
    "remainingApplicationCodeOwner": "Prism",
    "prismIntegration": [
        "project the complete asset inventory including fonts into immutable LSML",
        "own the packaged shared receiver lifecycle, origins, readiness, logout and shutdown",
        "sync immutable Canvas sources/Blue capsules at startup in stable per-account storage",
        "obtain and refresh admitted refs via the existing authorized workload broker flow",
        "drive Program/Preview with desired scene-control LSML and observed renderer acknowledgements",
        "consume Orion controls/stream-rule status and route viewer/capture capability declarations",
        "qualify the complete installed application and upgrade lifecycle",
    ],
    "externalBoundaries": [
        "local changes uncommitted/unpublished; remote Canvas source route still 404 until deployment",
        "operator denial on broker-only locator is expected, not evidence of missing artifacts",
        "mTLS workload broker retrieval was not exercised",
        "cached sources are immutable; execution leases expire normally, no indefinite offline authority",
        "offline command dispatch/error reporting proved; offline database business success not claimed",
        "camera proof is local WebRTC, no WAN/TURN or Linux release certification",
        "PostgreSQL and configured external integration tests skipped; no schema migration introduced",
        "no new long Pulsar soak, remote CI, production deployment or complete installed Prism E2E",
        "workspace checks cover new owned evidence and preserved continuations, not historical global layout",
    ],
}
for owner in [solar, orion, canvas]:
    owned = dict(report)
    owned["evidence"] = [{"path": Path(os.path.relpath(path, owner)).as_posix(), "sha256": sha(path)}
                         for path in dict.fromkeys(proofs)]
    destination = owner / relative / (prefix.name + "-certificate.json")
    destination.write_text(json.dumps(owned, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"result": report["result"], "solarTests": unit["numPassedTests"],
                  "orionRace": go_counts["testsAndSubtests"], "canvasTests": int(match[1]),
                  "preserved": list(preserved)}))
