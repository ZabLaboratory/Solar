// Boots mock-orion on a fixed port for the e2e suite. Tests reach it
// via process.env.SOLAR_E2E_ORION_WS / _HTTP.

import { startMockOrion, type MockOrion } from "../mock-orion/server";
import {
  ACCEPTANCE_BUNDLE,
  ACCEPTANCE_INITIAL_STATE,
  ACCEPTANCE_SCENE_ID,
} from "../fixtures/scenes";

declare global {
  // Stashed on globalThis so global-teardown can close the server.
  var __solarE2EMockOrion: MockOrion | undefined;
}

const MOCK_PORT = Number(process.env.SOLAR_E2E_MOCK_PORT ?? 51320);

async function globalSetup(): Promise<void> {
  const mock = await startMockOrion({
    port: MOCK_PORT,
    initialSceneId: ACCEPTANCE_SCENE_ID,
    initialBundle: ACCEPTANCE_BUNDLE,
    initialState: ACCEPTANCE_INITIAL_STATE,
  });
  globalThis.__solarE2EMockOrion = mock;
  process.env.SOLAR_E2E_ORION_WS = mock.url;
  process.env.SOLAR_E2E_ORION_HTTP = mock.httpUrl;
  console.log(
    `[solar-e2e] mock-orion : WS=${mock.url} HTTP=${mock.httpUrl}`,
  );
}

export default globalSetup;
