import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, extname } from "node:path";
import { createServer, type Server } from "node:http";

const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_FILES = 2048;
const formats = new Set([".ttf", ".otf", ".ttc", ".woff", ".woff2"]);
export interface InstallationFontEndpoint {
  url: string;
  token: string;
}
interface FontEntry {
  hash: string;
  bytes: number;
}
interface SourceEntry {
  path: string;
  size: number;
  modified: number;
  hash: string;
}

/** Installation-owned immutable files; no scene state is stored here. */
export class InstallationFonts {
  private server: Server | null = null;
  private entries = new Map<string, FontEntry>();
  private sourcePaths = new Map<string, Set<string>>();
  private readonly token = randomBytes(32).toString("hex");
  readonly report = {
    filesRead: 0,
    reused: 0,
    unsupported: [] as string[],
    files: 0,
    bytes: 0,
    indexRecovered: false,
    repaired: 0,
  };
  constructor(private readonly directory: string) {}

  async prepare(roots: readonly string[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    let previous: SourceEntry[] = [];
    try {
      const index: unknown = JSON.parse(
        await readFile(join(this.directory, "index.json"), "utf8"),
      );
      if (
        index &&
        typeof index === "object" &&
        "schema" in index &&
        index.schema === "solar.installation-fonts.v1" &&
        "sources" in index &&
        Array.isArray(index.sources) &&
        index.sources.every(
          (entry: unknown): entry is SourceEntry =>
            entry !== null &&
            typeof entry === "object" &&
            "path" in entry &&
            typeof entry.path === "string" &&
            entry.path.length > 0 &&
            "size" in entry &&
            typeof entry.size === "number" &&
            Number.isSafeInteger(entry.size) &&
            entry.size > 0 &&
            entry.size <= 64 * 1024 * 1024 &&
            "modified" in entry &&
            typeof entry.modified === "number" &&
            Number.isFinite(entry.modified) &&
            entry.modified >= 0 &&
            "hash" in entry &&
            typeof entry.hash === "string" &&
            /^[a-f0-9]{64}$/.test(entry.hash),
        )
      ) {
        previous = index.sources;
      } else {
        this.report.indexRecovered = true;
      }
    } catch (error) {
      if (error instanceof SyntaxError) this.report.indexRecovered = true;
      else if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const old = new Map(previous.map((entry) => [entry.path, entry]));
    const sources: SourceEntry[] = [];
    const visited = new Set<string>();
    for (const root of roots) {
      let names;
      try {
        const info = await stat(root);
        names = info.isFile()
          ? [{ name: root, isFile: () => true }]
          : await readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const name of names) {
        if (!name.isFile()) continue;
        const path = name.name === root ? root : join(root, name.name);
        if (visited.has(path.toLowerCase())) continue;
        visited.add(path.toLowerCase());
        if (!formats.has(extname(path).toLowerCase())) {
          if ([".fon", ".fnt"].includes(extname(path).toLowerCase()))
            this.report.unsupported.push(path);
          continue;
        }
        const info = await stat(path);
        if (!info.size || info.size > 64 * 1024 * 1024)
          throw new Error("INSTALLATION_FONT_FILE_LIMIT");
        const cached = old.get(path);
        let hash: string;
        if (
          cached?.size === info.size &&
          cached.modified === info.mtimeMs &&
          /^[a-f0-9]{64}$/.test(cached.hash) &&
          (await stat(join(this.directory, cached.hash)).then(
            (x) => x.size === info.size,
            () => false,
          ))
        ) {
          hash = cached.hash;
          this.report.reused++;
        } else {
          const bytes = await readFile(path);
          hash = createHash("sha256").update(bytes).digest("hex");
          const output = join(this.directory, hash);
          if (
            !(await stat(output).then(
              (x) => x.size === bytes.length,
              () => false,
            ))
          ) {
            const temporary =
              output + "." + randomBytes(8).toString("hex") + ".tmp";
            await writeFile(temporary, bytes, { flag: "wx" });
            await rename(temporary, output);
          }
          this.report.filesRead++;
        }
        sources.push({ path, size: info.size, modified: info.mtimeMs, hash });
        this.entries.set(hash, { hash, bytes: info.size });
        const paths = this.sourcePaths.get(hash) ?? new Set<string>();
        paths.add(path);
        this.sourcePaths.set(hash, paths);
        if (
          this.entries.size > MAX_FILES ||
          [...this.entries.values()].reduce((n, x) => n + x.bytes, 0) >
            MAX_BYTES
        )
          throw new Error("INSTALLATION_FONT_REGISTRY_LIMIT");
      }
    }
    this.report.files = this.entries.size;
    this.report.bytes = [...this.entries.values()].reduce(
      (n, x) => n + x.bytes,
      0,
    );
    const temporary = join(
      this.directory,
      "index." + randomBytes(8).toString("hex") + ".tmp",
    );
    await writeFile(
      temporary,
      JSON.stringify({ schema: "solar.installation-fonts.v1", sources }),
    );
    await rename(temporary, join(this.directory, "index.json"));
  }

  async start(origins: readonly string[]): Promise<InstallationFontEndpoint> {
    if (this.server)
      throw new Error("INSTALLATION_FONT_SERVICE_ALREADY_STARTED");
    const server = createServer(async (request, response) => {
      const origin = request.headers.origin;
      if (origin && !origins.includes(origin)) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (origin) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader("access-control-allow-headers", "Authorization");
        response.setHeader("access-control-allow-methods", "GET");
        response.writeHead(204);
        response.end();
        return;
      }
      if (
        request.method !== "GET" ||
        request.headers.authorization !== `Bearer ${this.token}`
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      try {
        response.setHeader("cache-control", "no-store");
        if (request.url === "/fonts") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify([...this.entries.values()]));
          return;
        }
        const hash = request.url?.match(/^\/fonts\/([a-f0-9]{64})$/)?.[1];
        if (!hash || !this.entries.has(hash)) {
          response.writeHead(404);
          response.end();
          return;
        }
        const bytes = await this.fontBytes(hash);
        response.setHeader("content-type", "application/octet-stream");
        response.end(bytes);
      } catch {
        response.writeHead(500);
        response.end();
      }
    });
    await new Promise<void>((yes, no) => {
      server.once("error", no);
      server.listen(0, "127.0.0.1", yes);
    });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("INSTALLATION_FONT_ADDRESS");
    return { url: `http://127.0.0.1:${address.port}/fonts`, token: this.token };
  }

  /** Repair only on a failed read/integrity check, without hashing the warm catalogue. */
  private async fontBytes(hash: string): Promise<Buffer> {
    const entry = this.entries.get(hash)!;
    const valid = (bytes: Buffer): boolean =>
      bytes.length === entry.bytes &&
      createHash("sha256").update(bytes).digest("hex") === hash;
    try {
      const bytes = await readFile(join(this.directory, hash));
      if (!valid(bytes)) throw new Error("INSTALLATION_FONT_INTEGRITY");
      return bytes;
    } catch (error) {
      for (const source of this.sourcePaths.get(hash) ?? []) {
        let bytes: Buffer;
        try {
          bytes = await readFile(source);
        } catch {
          continue;
        }
        // A changed source must not be served under the previously admitted hash.
        if (!valid(bytes)) continue;
        const output = join(this.directory, hash);
        const temporary =
          output + "." + randomBytes(8).toString("hex") + ".tmp";
        try {
          await writeFile(temporary, bytes, { flag: "wx" });
          await rename(temporary, output);
        } finally {
          await rm(temporary, { force: true });
        }
        this.report.repaired++;
        return bytes;
      }
      throw error;
    }
  }
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((yes, no) =>
      server.close((error) => (error ? no(error) : yes())),
    );
  }
}
