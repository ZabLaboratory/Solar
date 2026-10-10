import { strictJSON } from "./strict-json.js";
import { LSDPError, deferred } from "./error.js";
export const WIRE = "LSDP-TCP/2.0-draft2";
const DEFAULT = {
  frameBytes: 65536,
  windowBytes: 1048576,
  channelWindowBytes: 262144,
  mutationReserveBytes: 65536,
  messageBytes: 16777216,
  bufferedMessageBytes: 33554432,
  streamBytes: 1073741824,
  channels: 32,
  controlBytes: 8192,
  receiptBytes: 8192,
  timeoutMs: 30000,
  handshakeMs: 5000,
  idleMs: 120000,
};
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
function limits(input = {}) {
  const v = { ...DEFAULT, ...input };
  if (
    Object.keys(v).some(
      (k) => !Object.hasOwn(DEFAULT, k) || !Number.isSafeInteger(v[k]) || v[k] < 1,
    ) ||
    v.frameBytes < 1024 ||
    v.frameBytes > 1048576 ||
    v.windowBytes < v.frameBytes ||
    v.windowBytes > 67108864 ||
    v.channelWindowBytes > v.windowBytes ||
    v.mutationReserveBytes >= v.windowBytes ||
    v.messageBytes > 67108864 ||
    v.bufferedMessageBytes > 268435456 ||
    v.channels > 1024 ||
    v.controlBytes < 1024 ||
    v.controlBytes > v.frameBytes ||
    v.receiptBytes > v.controlBytes ||
    [v.timeoutMs, v.handshakeMs, v.idleMs].some((n) => n > 2147483647)
  )
    throw new LSDPError("INVALID_LIMITS");
  return v;
}
function json(value, max) {
  const text = JSON.stringify(value);
  strictJSON(text);
  const body = encoder.encode(text);
  if (body.length > max) throw new LSDPError("MESSAGE_LIMIT");
  return body;
}
/** Native browser APIs only. JSON transactions and bounded binary chunk uploads. */
export class BrowserLSDP {
  constructor(url, options = {}) {
    this.options = options;
    this.limits = limits(options.limits);
    this.readiness = deferred();
    this.ready = this.readiness.promise;
    this.calls = new Map();
    this.pings = new Map();
    this.pingId = 1n;
    this.incoming = new Map();
    this.lastIncoming = 0;
    this.receiveCredit = this.limits.windowBytes;
    this.incomingBytes = 0;
    this.queuedFrames = 0;
    this.queuedBytes = 0;
    this.waiters = new Set();
    this.channel = 1;
    this.sendSequence = 0;
    this.receiveSequence = 0;
    this.buffer = new Uint8Array();
    this.pendingBytes = 0;
    this.closed = false;
    this.writeChain = Promise.resolve();
    this.ready.catch(() => {});
    const Socket = options.WebSocket ?? globalThis.WebSocket;
    this.socket = new Socket(url, "lsdp.v2.draft2");
    this.socket.binaryType = "arraybuffer";
    this.handshake = setTimeout(
      () => this._close(new LSDPError("HANDSHAKE_TIMEOUT")),
      this.limits.handshakeMs,
    );
    this.socket.addEventListener("open", () =>
      this._write(
        1,
        0,
        0n,
        json(
          {
            wire: WIRE,
            role: "client",
            limits: this.limits,
            ...(options.authToken ? { authToken: options.authToken } : {}),
          },
          this.limits.controlBytes,
        ),
      ).catch((e) => this._close(e)),
    );
    this.socket.addEventListener("message", (event) => {
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new LSDPError("BINARY_REQUIRED");
        this._read(new Uint8Array(event.data));
      } catch (e) {
        this._close(e);
      }
    });
    this.socket.addEventListener("error", () =>
      this._close(new LSDPError("CONNECTION_LOST", "unknown")),
    );
    this.socket.addEventListener("close", () =>
      this._close(new LSDPError("CONNECTION_LOST", "unknown")),
    );
  }
  _notify() {
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }
  _read(bytes) {
    if (
      bytes.length > this.limits.frameBytes + 32 ||
      this.buffer.length + bytes.length > 2 * (this.limits.frameBytes + 32)
    )
      throw new LSDPError("FRAME_LIMIT");
    const buffer = new Uint8Array(this.buffer.length + bytes.length);
    buffer.set(this.buffer);
    buffer.set(bytes, this.buffer.length);
    this.buffer = buffer;
    while (this.buffer.length >= 32) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset),
        size = view.getUint32(20),
        sequence = view.getUint32(24),
        type = view.getUint8(5),
        channel = view.getUint32(8),
        id = view.getBigUint64(12);
      if (
        decoder.decode(this.buffer.subarray(0, 4)) !== "LSDP" ||
        view.getUint8(4) !== 2 ||
        view.getUint16(6) !== 0 ||
        view.getUint32(28) !== 0 ||
        type < 1 ||
        type > 10 ||
        size > this.limits.frameBytes
      )
        throw new LSDPError("INVALID_HEADER");
      if (this.buffer.length < 32 + size) break;
      if (sequence !== ++this.receiveSequence) throw new LSDPError("SEQUENCE_MISMATCH");
      const body = this.buffer.slice(32, 32 + size);
      this.buffer = this.buffer.slice(32 + size);
      if (type !== 3 && body.length > this.limits.controlBytes)
        throw new LSDPError("CONTROL_LIMIT");
      this._frame(type, channel, id, body);
    }
  }
  _frame(type, channel, id, body) {
    if (type === 1) {
      if (this.remote || channel !== 0 || id !== 0n) throw new LSDPError("INVALID_HELLO");
      const hello = strictJSON(decoder.decode(body));
      if (
        hello.wire !== WIRE ||
        hello.role !== "server" ||
        Object.keys(DEFAULT).some((k) => !Object.hasOwn(hello.limits ?? {}, k))
      )
        throw new LSDPError("INCOMPATIBLE_WIRE");
      this.remote = limits(hello.limits);
      this.credit = this.remote.windowBytes;
      this.profiles = hello.profiles ?? [];
      clearTimeout(this.handshake);
      this.readiness.resolve(this);
      if (this.options.keepalive !== false) {
        this.keepalive = setInterval(
          () => {
            if (!this.pings.size) this.ping().catch((error) => this._close(error));
          },
          Math.max(1, Math.floor(Math.min(this.limits.idleMs, this.remote.idleMs) / 3)),
        );
      }
      return;
    }
    if (!this.remote) throw new LSDPError("HELLO_REQUIRED");
    if (type === 5) {
      if (id !== 0n || body.length !== 4) throw new LSDPError("INVALID_CREDIT");
      const n = new DataView(body.buffer, body.byteOffset).getUint32(0);
      if (!n) throw new LSDPError("INVALID_CREDIT");
      if (channel === 0) {
        if (this.credit + n > this.remote.windowBytes) throw new LSDPError("INVALID_CREDIT");
        this.credit += n;
      } else {
        const call = this.calls.get(channel);
        if (call) {
          if (call.credit + n > this.remote.channelWindowBytes)
            throw new LSDPError("INVALID_CREDIT");
          call.credit += n;
        } else if (channel % 2 !== 1 || channel >= this.channel)
          throw new LSDPError("UNKNOWN_CHANNEL");
      }
      this._notify();
      return;
    }
    if (type === 9) {
      if (channel !== 0 || id === 0n || body.length) throw new LSDPError("INVALID_PING");
      this._write(10, 0, id, body).catch((e) => this._close(e));
      return;
    }
    if (type === 10) {
      if (channel !== 0 || id === 0n || body.length || !this.pings.has(id))
        throw new LSDPError("INVALID_PONG");
      const ping = this.pings.get(id);
      clearTimeout(ping.timer);
      this.pings.delete(id);
      ping.resolve();
      return;
    }
    if (type === 6 || type === 7) {
      const call = this.calls.get(channel);
      if (!call) {
        if (channel % 2 === 1 && channel < this.channel) return;
        throw new LSDPError("UNKNOWN_CHANNEL");
      }
      if (call.id !== id) throw new LSDPError("ID_MISMATCH");
      const value = strictJSON(decoder.decode(body));
      if (type === 6) {
        if (
          !call.commitSent ||
          body.length > this.limits.receiptBytes ||
          !Object.hasOwn(value, "result")
        )
          throw new LSDPError("INVALID_ACK");
        this._finish(call);
        call.resolve(value.result);
      } else {
        if (
          !/^[A-Z0-9_]{1,64}$/.test(value.code) ||
          !["rejected", "unknown"].includes(value.outcome)
        )
          throw new LSDPError("INVALID_ERROR");
        this._finish(call);
        call.reject(new LSDPError(value.code, value.outcome));
      }
      return;
    }
    if (channel === 0 || channel % 2 !== 0 || id === 0n) throw new LSDPError("INVALID_CHANNEL");
    if (type === 2) {
      if (channel <= this.lastIncoming) throw new LSDPError("CHANNEL_REUSED");
      this.lastIncoming = channel;
      const begin = strictJSON(decoder.decode(body));
      if (
        begin.kind !== "json" ||
        !Number.isSafeInteger(begin.length) ||
        begin.length < 0 ||
        begin.length > this.limits.messageBytes
      )
        throw new LSDPError("UNSUPPORTED_BROWSER_FRAME");
      if (
        !this.options.onTransaction ||
        this.incoming.size >= this.limits.channels ||
        this.incomingBytes + begin.length > this.limits.bufferedMessageBytes
      ) {
        this._write(
          7,
          channel,
          id,
          json({ code: "CAPACITY_LIMIT", outcome: "rejected" }, this.limits.controlBytes),
        ).catch((e) => this._close(e));
        return;
      }
      const entry = {
        channel,
        id,
        buffer: new Uint8Array(begin.length),
        offset: 0,
        credit: this.limits.channelWindowBytes,
        metadata: begin.metadata,
        aborter: new AbortController(),
      };
      entry.context = {
        metadata: entry.metadata,
        signal: entry.aborter.signal,
        channel,
        transactionId: String(id),
        peer: this,
      };
      this.incoming.set(channel, entry);
      this.incomingBytes += begin.length;
      entry.timer = setTimeout(
        () => this._abortIncoming(entry, new LSDPError("TRANSACTION_TIMEOUT", "unknown")),
        this.limits.timeoutMs,
      );
      return;
    }
    const entry = this.incoming.get(channel);
    if (!entry && channel > this.lastIncoming) throw new LSDPError("UNKNOWN_CHANNEL");
    if (entry && entry.id !== id) throw new LSDPError("ID_MISMATCH");
    if (type === 3) {
      if (!body.length || body.length > this.receiveCredit || (entry && body.length > entry.credit))
        throw new LSDPError("CREDIT_EXCEEDED");
      this.receiveCredit -= body.length;
      if (entry) {
        if (entry.committed || entry.offset + body.length > entry.buffer.length)
          throw new LSDPError("PAYLOAD_TOO_LARGE");
        entry.buffer.set(body, entry.offset);
        entry.offset += body.length;
      }
      this.receiveCredit += body.length;
      const credit = new Uint8Array(4);
      new DataView(credit.buffer).setUint32(0, body.length);
      this._write(5, 0, 0n, credit).catch((e) => this._close(e));
      this._write(5, channel, 0n, credit).catch((e) => this._close(e));
      return;
    }
    if (type === 8) {
      if (body.length) throw new LSDPError("INVALID_CANCEL");
      if (entry) this._abortIncoming(entry, new LSDPError("CANCELLED", "unknown"));
      return;
    }
    if (type === 4) {
      if (body.length !== 40) throw new LSDPError("INVALID_COMMIT");
      if (!entry) return;
      if (entry.committed) throw new LSDPError("DUPLICATE_COMMIT");
      entry.committed = true;
      (async () => {
        try {
          const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", entry.buffer));
          entry.aborter.signal.throwIfAborted();
          if (
            entry.offset !== entry.buffer.length ||
            new DataView(body.buffer, body.byteOffset).getBigUint64(0) !== BigInt(entry.offset) ||
            hash.some((n, i) => n !== body[8 + i])
          )
            throw new LSDPError("INTEGRITY_FAILED");
          const value = strictJSON(decoder.decode(entry.buffer)),
            result = await this.options.onTransaction(value, entry.context);
          entry.aborter.signal.throwIfAborted();
          if (this.incoming.has(channel)) {
            await this._write(
              6,
              channel,
              id,
              json(
                { result: result ?? null },
                Math.min(this.limits.receiptBytes, this.remote.receiptBytes),
              ),
            );
            this._disposeIncoming(entry);
          }
        } catch (e) {
          this._abortIncoming(entry, e);
        }
      })();
      return;
    }
    throw new LSDPError("INVALID_FRAME_STATE");
  }
  _disposeIncoming(entry) {
    if (!this.incoming.has(entry.channel)) return;
    clearTimeout(entry.timer);
    this.incoming.delete(entry.channel);
    this.incomingBytes -= entry.buffer.length;
  }
  _abortIncoming(entry, error) {
    if (!this.incoming.has(entry.channel)) return;
    this._disposeIncoming(entry);
    entry.aborter.abort(error);
    this._incomingFailed(entry, error);
    const code =
      error instanceof LSDPError && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : "APPLICATION_FAILED";
    this._write(
      7,
      entry.channel,
      entry.id,
      json({ code, outcome: "unknown" }, this.limits.controlBytes),
    ).catch(() => {});
  }
  _incomingFailed(entry, error) {
    Promise.resolve()
      .then(() => this.options.onIncomingFailed?.(entry.context, error))
      .catch(() => {});
  }
  _write(type, channel, id, body = new Uint8Array()) {
    if (++this.queuedFrames > 4096 || (this.queuedBytes += body.length + 32) > 4194304) {
      this._close(new LSDPError("CONTROL_QUEUE_LIMIT"));
      return Promise.reject(new LSDPError("CONTROL_QUEUE_LIMIT"));
    }
    const next = this.writeChain
      .then(async () => {
        while (this.socket.bufferedAmount > this.limits.windowBytes) {
          if (this.closed) throw new LSDPError("CONNECTION_LOST", "unknown");
          await new Promise((r) => setTimeout(r, 1));
        }
        if (this.closed) throw new LSDPError("CONNECTION_LOST", "unknown");
        if (
          body.length >
            Math.min(this.limits.frameBytes, this.remote?.frameBytes ?? this.limits.frameBytes) ||
          this.sendSequence >= 0xffffffff
        )
          throw new LSDPError("FRAME_LIMIT");
        const frame = new Uint8Array(32 + body.length),
          view = new DataView(frame.buffer);
        frame.set(encoder.encode("LSDP"));
        view.setUint8(4, 2);
        view.setUint8(5, type);
        view.setUint32(8, channel);
        view.setBigUint64(12, id);
        view.setUint32(20, body.length);
        view.setUint32(24, ++this.sendSequence);
        frame.set(body, 32);
        this.socket.send(frame);
      })
      .finally(() => {
        this.queuedFrames--;
        this.queuedBytes -= body.length + 32;
      });
    this.writeChain = next.catch(() => {});
    return next;
  }
  _finish(call) {
    if (call.finished) return;
    call.finished = true;
    clearTimeout(call.timer);
    call.signal?.removeEventListener("abort", call.abort);
    this.calls.delete(call.channel);
    this.pendingBytes -= call.bytes;
    this._notify();
  }
  async _send(body, kind, metadata, { signal, timeoutMs = this.limits.timeoutMs } = {}) {
    await this.ready;
    signal?.throwIfAborted();
    if (this.closed) throw new LSDPError("CONNECTION_LOST", "unknown");
    if (
      this.calls.size >= Math.min(this.limits.channels, this.remote.channels) ||
      this.pendingBytes + body.length > this.limits.bufferedMessageBytes
    )
      throw new LSDPError("CAPACITY_LIMIT");
    if (
      body.length >
      (kind === "json"
        ? Math.min(this.limits.messageBytes, this.remote.messageBytes)
        : Math.min(this.limits.messageBytes, this.remote.streamBytes))
    )
      throw new LSDPError("MESSAGE_LIMIT");
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 2147483647 ||
      this.channel > 0xffffffff
    )
      throw new LSDPError("INVALID_LIMITS");
    const channel = this.channel;
    this.channel += 2;
    const call = {
      ...deferred(),
      channel,
      id: BigInt(channel),
      credit: this.remote.channelWindowBytes,
      bytes: body.length,
      signal,
    };
    call.promise.catch(() => {});
    this.calls.set(channel, call);
    this.pendingBytes += body.length;
    const cancel = (code) => {
      if (call.finished) return;
      this._finish(call);
      call.reject(new LSDPError(code, call.commitSent ? "unknown" : "rejected"));
      this._write(8, channel, call.id).catch(() => {});
    };
    call.abort = () => cancel("CANCELLED");
    signal?.addEventListener("abort", call.abort, { once: true });
    call.timer = setTimeout(() => cancel("TRANSACTION_TIMEOUT"), timeoutMs);
    (async () => {
      try {
        await this._write(
          2,
          channel,
          call.id,
          json(
            { kind, length: body.length, metadata },
            Math.min(this.limits.controlBytes, this.remote.controlBytes),
          ),
        );
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
        for (let offset = 0; offset < body.length; ) {
          const reserve = kind === "stream" ? this.remote.mutationReserveBytes : 0;
          while (call.credit < 1 || this.credit <= reserve) {
            if (call.finished) throw new LSDPError("CANCELLED");
            await new Promise((r) => this.waiters.add(r));
          }
          if (call.finished) throw new LSDPError("CANCELLED");
          const n = Math.min(
            body.length - offset,
            this.limits.frameBytes,
            this.remote.frameBytes,
            call.credit,
            this.credit - reserve,
          );
          call.credit -= n;
          this.credit -= n;
          await this._write(3, channel, call.id, body.subarray(offset, offset + n));
          offset += n;
        }
        if (call.finished) return;
        const commit = new Uint8Array(40);
        new DataView(commit.buffer).setBigUint64(0, BigInt(body.length));
        commit.set(hash, 8);
        call.commitSent = true;
        await this._write(4, channel, call.id, commit);
      } catch (e) {
        if (!call.finished) {
          this._finish(call);
          call.reject(e);
        }
      }
    })();
    return call.promise;
  }
  transaction(value, options = {}) {
    return this._send(json(value, this.limits.messageBytes), "json", null, options);
  }
  stream(body, { metadata = null, ...options } = {}) {
    if (!(body instanceof Uint8Array)) throw new LSDPError("BYTES_REQUIRED");
    return this._send(body, "stream", metadata, options);
  }
  async ping({ timeoutMs = this.limits.timeoutMs } = {}) {
    await this.ready;
    if (this.closed) throw new LSDPError("CONNECTION_LOST", "unknown");
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 2147483647 ||
      this.pings.size >= 16 ||
      this.pingId > 0xffffffffffffffffn
    )
      throw new LSDPError("PING_LIMIT");
    const id = this.pingId++,
      ping = deferred();
    this.pings.set(id, ping);
    ping.timer = setTimeout(() => {
      this.pings.delete(id);
      ping.reject(new LSDPError("PING_TIMEOUT", "unknown"));
    }, timeoutMs);
    this._write(9, 0, id).catch((error) => {
      clearTimeout(ping.timer);
      this.pings.delete(id);
      ping.reject(error);
    });
    return ping.promise;
  }
  _close(error) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.handshake);
    clearInterval(this.keepalive);
    this.readiness.reject(error);
    for (const call of [...this.calls.values()]) {
      this._finish(call);
      call.reject(
        new LSDPError(error.code ?? "CONNECTION_LOST", call.commitSent ? "unknown" : "rejected"),
      );
    }
    for (const entry of [...this.incoming.values()]) {
      this._disposeIncoming(entry);
      entry.aborter.abort(error);
      this._incomingFailed(entry, error);
    }
    for (const ping of this.pings.values()) {
      clearTimeout(ping.timer);
      ping.reject(error);
    }
    this.pings.clear();
    this._notify();
    this.socket.close();
    this.options.onClose?.(error);
  }
  close() {
    this._close(new LSDPError("CONNECTION_LOST", "unknown"));
  }
}
export async function connectBrowserLSDP(url, options = {}) {
  const peer = new BrowserLSDP(url, options);
  await peer.ready;
  return peer;
}
