// Explicit test gateway: actual authenticated read queries; token RAM only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
const [sessionPath, credentialPath, outputPath] = process.argv.slice(2);
if (!sessionPath || !credentialPath || !outputPath)
  throw new Error(
    "Expected session, credentials and owning-repo output paths.",
  );
const output = resolve(outputPath);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
await mkdir(output, { recursive: true });
const session = JSON.parse(await readFile(sessionPath, "utf8"));
const credentials = {};
for (const line of (await readFile(credentialPath, "utf8")).split(/\r?\n/)) {
  const match =
    /^\s*(PRISM_E2E_OPERATOR_EMAIL|PRISM_E2E_OPERATOR_PASSWORD)\s*=\s*(.*)\s*$/.exec(
      line,
    );
  if (match) credentials[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
if (credentials.PRISM_E2E_OPERATOR_EMAIL?.toLowerCase() !== "zaboutine")
  throw new Error("Proof account mismatch.");
const login = await fetch(session.gatewayUrl + "/auth/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: credentials.PRISM_E2E_OPERATOR_EMAIL,
    password: credentials.PRISM_E2E_OPERATOR_PASSWORD,
    keep_signed_in: false,
  }),
  signal: AbortSignal.timeout(10000),
});
delete credentials.PRISM_E2E_OPERATOR_PASSWORD;
if (!login.ok) throw new Error("Proof login rejected: " + login.status);
const token = (await login.json()).access_token;
const me = await fetch(session.gatewayUrl + "/auth/api/v1/auth/me", {
  headers: { Authorization: "Bearer " + token },
  signal: AbortSignal.timeout(10000),
});
if (!me.ok) throw new Error("Proof identity rejected: " + me.status);
const records = [];
const server = createServer(async (request, response) => {
  if (
    request.method !== "POST" ||
    !/^\/(truth|ranking)\/api\/v1\/_query$/.test(request.url)
  ) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    let body = "",
      length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 1048576) throw new Error("Query too large");
      body += chunk;
    }
    const remote = await fetch(session.gatewayUrl + request.url, {
      method: "POST",
      body,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = await remote.text();
    records.push({
      path: request.url,
      descriptor: JSON.parse(body),
      status: remote.status,
      response: JSON.parse(text),
    });
    await writeFile(
      join(output, stamp + "-read-queries.json"),
      JSON.stringify(records, null, 2),
    );
    response.writeHead(remote.status, { "Content-Type": "application/json" });
    response.end(text);
  } catch (error) {
    response.writeHead(502);
    response.end(JSON.stringify({ error: error.name }));
  }
});
await new Promise((yes) => server.listen(0, "127.0.0.1", yes));
console.log(
  JSON.stringify({
    queryProxy: "http://127.0.0.1:" + server.address().port,
    authenticated: true,
    persistence: "proof responses only; no session/credential writes",
  }),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.closeAllConnections();
    server.close();
  });
