// Example consumer of <PrismSceneEmbed> — bumps the `play` prop to
// trigger a Score Update animation. Drop this into any Vite/CRA/Next
// project that has react + react-dom + @zablab/solar installed.

import { useRef, useState } from "react";
import {
  PrismSceneEmbed,
  type PrismSceneEmbedHandle,
} from "./PrismSceneEmbed";
import type { SceneJson } from "@zablab/solar";

const SCENE: SceneJson = {
  state: { "score.value": 0 },
  html: `
    <div style="background:#161a23;padding:2rem 3rem;border-radius:12px;text-align:center;">
      <p style="margin:0;color:#8e95a7;letter-spacing:0.08em;text-transform:uppercase;">Score</p>
      <h1 style="margin:0;font-size:4rem;font-weight:800;" data-anim-path="score.value">0</h1>
    </div>
  `,
  animations: {
    "Score Update": {
      patches: [
        {
          path: "score.value",
          value: "${param.score_to}",
          action: {
            kind: "count-up",
            params: { from: 0, to: "${param.score_to}" },
            duration_ms: 800,
            easing: "ease-out",
          },
        },
      ],
    },
  },
};

export function App() {
  const [score, setScore] = useState<number>(0);
  const [play, setPlay] = useState<
    { assetId: string; params?: Record<string, unknown> } | null
  >(null);
  const ref = useRef<PrismSceneEmbedHandle | null>(null);

  const trigger = (target: number) => {
    setScore(target);
    // New object identity → effect inside PrismSceneEmbed re-fires.
    setPlay({ assetId: "Score Update", params: { score_to: target } });
  };

  return (
    <div style={{ display: "grid", placeItems: "center", gap: "1.5rem" }}>
      <PrismSceneEmbed
        ref={ref}
        scene={SCENE}
        play={play}
        onCompleted={(id) => console.log("done :", id)}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button onClick={() => trigger(1891)}>1891</button>
        <button onClick={() => trigger(2024)}>2024</button>
        <button onClick={() => trigger(0)}>reset</button>
      </div>
      <small>current target : {score}</small>
    </div>
  );
}
