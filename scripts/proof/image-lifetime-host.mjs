import { spawn } from "node:child_process";
import { createServer } from "node:http";

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return port;
}

function waitForHostReady(child, stderr) {
  return new Promise((resolveReady, rejectReady) => {
    let pending = "";
    let ready = false;
    const timer = setTimeout(
      () =>
        rejectReady(
          new Error(
            "Private Solar host did not become ready within 30 seconds.",
          ),
        ),
      30000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const value = parseJson(line);
        if (value?.solar && value?.native && value?.nativePid) {
          ready = true;
          clearTimeout(timer);
          resolveReady(value);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectReady(error);
    });
    child.once("exit", (code, signal) => {
      if (!ready) {
        clearTimeout(timer);
        rejectReady(
          new Error(
            `Private Solar host exited before ready (${code}, ${signal ?? "no signal"}).`,
          ),
        );
      }
    });
  });
}

export async function waitForOwnedHostExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null)
    return true;
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

/** Launch only this qualification's private in-memory Solar host. */
export async function startImageLifetimeHost({
  nativeServerPath,
  scenePath,
  nativeBinary,
  root,
}) {
  const port = await reservePort();
  const child = spawn(
    process.execPath,
    [
      nativeServerPath,
      "--scene",
      scenePath,
      "--lsdp-bin",
      nativeBinary,
      "--port",
      String(port),
    ],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr = [];
  const ready = await waitForHostReady(child, stderr);
  return {
    port,
    process: child,
    origin: new URL(ready.solar).origin,
    ready,
    stderr,
  };
}
