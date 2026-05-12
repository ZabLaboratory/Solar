// React wrapper around @zablab/solar's PrismScene. Drop into any
// React tree ; pass a sceneJson + (optionally) a `play` directive
// the parent updates to trigger an animation.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PrismScene, type SceneJson } from "@zablab/solar";

export interface PrismSceneEmbedProps {
  scene: SceneJson;
  /** Pass `{ assetId, params? }` and bump the object identity to
   *  trigger a playAnimation call. Set to null to do nothing. */
  play?: { assetId: string; params?: Record<string, unknown> } | null;
  onCompleted?: (assetId: string) => void;
  onError?: (assetId: string, error: unknown) => void;
}

export interface PrismSceneEmbedHandle {
  playAnimation(assetId: string, params?: Record<string, unknown>): Promise<void>;
  stopAnimation(assetId: string): void;
}

export const PrismSceneEmbed = forwardRef<PrismSceneEmbedHandle, PrismSceneEmbedProps>(
  function PrismSceneEmbed({ scene, play, onCompleted, onError }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<PrismScene | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      const s = new PrismScene({ sceneJson: scene });
      s.mount(containerRef.current);
      sceneRef.current = s;
      const onDone = ({ asset_id }: { asset_id: string }) => {
        onCompleted?.(asset_id);
      };
      const onErr = ({ asset_id, error }: { asset_id: string; error?: unknown }) => {
        onError?.(asset_id, error);
      };
      s.on("animation:completed", onDone);
      s.on("animation:error", onErr);
      return () => {
        s.off("animation:completed", onDone);
        s.off("animation:error", onErr);
        s.unmount();
        sceneRef.current = null;
      };
      // Recreating the PrismScene on scene changes keeps the
      // example simple ; production code would use scene.setScene().
    }, [scene, onCompleted, onError]);

    useEffect(() => {
      if (!play || !sceneRef.current) return;
      sceneRef.current.playAnimation(play.assetId, play.params).catch((err) => {
        if ((err as { code?: string })?.code === "ALREADY_PLAYING") return;
        onError?.(play.assetId, err);
      });
    }, [play, onError]);

    useImperativeHandle(
      ref,
      () => ({
        playAnimation: (assetId, params) =>
          sceneRef.current
            ? sceneRef.current.playAnimation(assetId, params)
            : Promise.resolve(),
        stopAnimation: (assetId) => {
          sceneRef.current?.stopAnimation(assetId);
        },
      }),
      [],
    );

    return <div ref={containerRef} />;
  },
);
