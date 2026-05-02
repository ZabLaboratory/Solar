async function globalTeardown(): Promise<void> {
  const mock = globalThis.__solarE2EMockOrion;
  if (mock) {
    await mock.close();
    globalThis.__solarE2EMockOrion = undefined;
  }
}

export default globalTeardown;
