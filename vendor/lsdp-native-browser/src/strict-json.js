import { fail } from "./error.js";

const surrogates = /[\ud800-\udfff]/;
export function unicode(value) {
  // Long ordinary strings are checked by V8's native character scan. Strings
  // containing any surrogate still take the exact paired-code-unit validator.
  if (value.length >= 16 && !surrogates.test(value)) return;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("INVALID_UNICODE");
    } else if (c >= 0xdc00 && c <= 0xdfff) fail("INVALID_UNICODE");
  }
}
export function number(value) {
  if (!Number.isFinite(value)) fail("INVALID_JSON");
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail("UNSAFE_NUMBER");
}
/** Validate budgets/duplicates before the native parser constructs the value graph. */
export function strictJSON(text) {
  let at = 0,
    nodes = 0;
  const whitespace = () => {
    for (;;) {
      const c = text.charCodeAt(at);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) return;
      at++;
    }
  };
  // JSON forbids unescaped characters below U+0020; other special code units
  // need the full escape/surrogate validator instead of the simple-string path.
  const special = /[^\u0020-\uffff]|[\\\ud800-\udfff]/;
  const numeric = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  function string() {
    const start = at++,
      end = text.indexOf('"', at);
    if (end < 0) fail("INVALID_JSON");
    const simple = text.slice(at, end);
    if (!special.test(simple)) {
      at = end + 1;
      return simple;
    }
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') {
        let value;
        try {
          value = JSON.parse(text.slice(start, at));
        } catch {
          fail("INVALID_JSON");
        }
        unicode(value);
        return value;
      }
      if (c === "\\") at++;
    }
    fail("INVALID_JSON");
  }
  function value(depth) {
    if (++nodes > 1000000 || depth > 128) fail("JSON_LIMIT");
    whitespace();
    const c = text[at];
    if (c === '"') {
      string();
      return;
    }
    if (c === "{" || c === "[") {
      at++;
      whitespace();
      const object = c === "{";
      const end = object ? "}" : "]";
      let first,
        second,
        third,
        fourth,
        seen = null,
        keyCount = 0;
      if (text[at] === end) {
        at++;
        return;
      }
      for (;;) {
        if (object) {
          if (text[at] !== '"') fail("INVALID_JSON");
          const key = string();
          // Most wire objects contain 2-4 fields. Avoid allocating a Set for
          // every operation while still comparing fully decoded key strings.
          if (seen) {
            if (seen.has(key)) fail("DUPLICATE_KEY");
            seen.add(key);
          } else {
            if (key === first || key === second || key === third || key === fourth)
              fail("DUPLICATE_KEY");
            if (keyCount === 0) first = key;
            else if (keyCount === 1) second = key;
            else if (keyCount === 2) third = key;
            else if (keyCount === 3) fourth = key;
            else seen = new Set([first, second, third, fourth, key]);
          }
          keyCount++;
          whitespace();
          if (text[at++] !== ":") fail("INVALID_JSON");
          value(depth + 1);
        } else value(depth + 1);
        whitespace();
        if (text[at] === end) {
          at++;
          return;
        }
        if (text[at++] !== ",") fail("INVALID_JSON");
        whitespace();
      }
    }
    for (const token of ["true", "false", "null"]) {
      if (text.startsWith(token, at)) {
        at += token.length;
        return;
      }
    }
    numeric.lastIndex = at;
    const matched = numeric.exec(text);
    if (!matched) fail("INVALID_JSON");
    at += matched[0].length;
    const result = Number(matched[0]);
    number(result);
  }
  value(0);
  whitespace();
  if (at !== text.length) fail("INVALID_JSON");
  try {
    return JSON.parse(text);
  } catch {
    fail("INVALID_JSON");
  }
}
