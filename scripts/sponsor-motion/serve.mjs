import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(root, process.argv[2] ?? "fixtures/sponsor-motion");
const port = Number(process.env.SPONSOR_MOTION_PORT ?? 4550), inner = port + 1;
const native = `http://127.0.0.1:${inner}`;
await mkdir(resolve(root, ".cache/sponsor-motion"), { recursive: true });
const log = createWriteStream(resolve(root, `.cache/sponsor-motion/native-${port}.log`));
const args = ["scripts/native-lsdp-local.mjs", "--scene", resolve(fixture, "sponsor-motion.lsmlz"), "--port", String(inner), "--status-parent", `http://127.0.0.1:${port}`];
if (process.env.SPONSOR_LSDP_BIN) args.push("--lsdp-bin", process.env.SPONSOR_LSDP_BIN);
const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log); child.stderr.pipe(log);
const catalogue = JSON.parse(await readFile(resolve(fixture, "catalogue.json"), "utf8"));
let run = 0, closed = false;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/favicon.ico") return res.writeHead(204).end();
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end((await readFile(resolve(import.meta.dirname, "player.html"), "utf8")).replaceAll("__SOLAR_ORIGIN__", native)
        .replaceAll("Sponsor Motion", catalogue.title ?? "Sponsor Motion")
        .replaceAll("__MOTION_DESCRIPTION__", catalogue.description ?? "Transition LSML"));
    }
    if (url.pathname === "/catalogue") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(catalogue)); }
    if (url.pathname === "/play" && req.method === "POST") {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 4096) throw Error("Control body exceeds 4 KiB"); chunks.push(chunk); }
      const command = length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (!["play","pause","resume","seek","speed","reverse","stop","cancel"].includes(command.action ?? "play")) throw Error("Invalid motion action");
      const selected = command.animation_id ? [command.animation_id] : catalogue.animations;
      if (!selected.every(id => catalogue.animations.includes(id))) throw Error("Unknown animation id");
      const id = `sponsor-demo-${++run}`;
      const operations = selected.map(animation_id => ({ op: "add", path: `/defaults/__animation.${animation_id}`, value: { ...command, animation_id, command_id: `${id}-${animation_id}` } }));
      const response = await fetch(`${native}/mutations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operations) });
      res.writeHead(response.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ command_id: id, animations: operations.length, duration_ms: catalogue.duration_ms, receipt: await response.json() }));
    }
    if (url.pathname === "/status") {
      const response = await fetch(`${native}/health`);
      res.writeHead(response.status, { "Content-Type": "application/json" });
      return res.end(await response.text());
    }
    if (url.pathname === "/scene.lsml" || url.pathname === "/scene.lsmlz") {
      res.setHeader("Content-Type", url.pathname.endsWith("lsmlz") ? "application/zip" : "application/json");
      return res.end(await readFile(resolve(fixture, `sponsor-motion.${url.pathname.endsWith("lsmlz") ? "lsmlz" : "lsml"}`)));
    }
    res.writeHead(404).end();
  } catch (error) { res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message })); }
});
server.listen(port, "127.0.0.1", () => console.log(`Sponsor motion: http://127.0.0.1:${port}`));
function stop() { if (closed) return; closed = true; server.closeAllConnections(); server.close(); child.kill("SIGTERM"); }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
child.once("exit", code => { if (!closed) { console.error(`Solar native host exited: ${code}`); stop(); process.exitCode = code ?? 1; } });
