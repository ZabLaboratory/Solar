/** Fetch only manifest-admitted installation fonts; release transport batches after admission. */
export async function* installationFontBatches(endpoint: {
  url: string;
  token: string;
}): AsyncGenerator<Uint8Array[]> {
  const url = new URL(endpoint.url);
  if (
    url.protocol !== "http:" ||
    !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("INSTALLATION_FONT_HOST_REQUIRED");
  const headers = { Authorization: `Bearer ${endpoint.token}` };
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("INSTALLATION_FONT_MANIFEST_UNAVAILABLE");
  const entries = (await response.json()) as Array<{
    hash: string;
    bytes: number;
  }>;
  if (
    !Array.isArray(entries) ||
    entries.length > 2048 ||
    entries.some(
      (e) =>
        !e ||
        !/^[a-f0-9]{64}$/.test(e.hash) ||
        !Number.isSafeInteger(e.bytes) ||
        e.bytes <= 0 ||
        e.bytes > 64 * 1024 * 1024,
    ) ||
    entries.reduce((n, e) => n + e.bytes, 0) > 1024 * 1024 * 1024
  )
    throw new Error("INSTALLATION_FONT_MANIFEST_INVALID");
  let batch: Uint8Array[] = [],
    size = 0;
  for (const entry of entries) {
    if (size + entry.bytes > 64 * 1024 * 1024 || batch.length === 32) {
      yield batch;
      batch = [];
      size = 0;
    }
    const response = await fetch(`${url.href}/${entry.hash}`, {
      headers,
      redirect: "error",
    });
    if (!response.ok) throw new Error("INSTALLATION_FONT_ASSET_UNAVAILABLE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== entry.hash || bytes.length !== entry.bytes)
      throw new Error("INSTALLATION_FONT_ASSET_INTEGRITY");
    batch.push(bytes);
    size += bytes.length;
  }
  if (batch.length) yield batch;
}
