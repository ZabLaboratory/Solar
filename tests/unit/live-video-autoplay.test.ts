import { afterEach, describe, expect, it, vi } from "vitest";
import { installLiveVideoAutoplay } from "../../src/internal/live-video-autoplay";

function videoWithStream(muted = false): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "srcObject", {
    configurable: true,
    value: {} as MediaStream,
    writable: true,
  });
  Object.defineProperty(video, "paused", {
    configurable: true,
    value: true,
  });
  video.muted = muted;
  video.play = vi.fn(() => Promise.resolve());
  video.dataset.lumencastMediaLive = "true";
  return video;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("installLiveVideoAutoplay()", () => {
  it("mutes interactive video and restores the prior state on teardown", () => {
    const video = videoWithStream(false);
    document.body.append(video);

    const disconnect = installLiveVideoAutoplay(false);

    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
    disconnect();
    expect(video.muted).toBe(false);
  });

  it("does not mute broadcast audio", () => {
    const video = videoWithStream(false);
    document.body.append(video);

    const disconnect = installLiveVideoAutoplay(true);

    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(1);
    disconnect();
    expect(video.muted).toBe(false);
  });

  it("retries when a live video is inserted after mount", async () => {
    const disconnect = installLiveVideoAutoplay(false);
    const video = videoWithStream();
    document.body.append(video);

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(video.play).toHaveBeenCalled();
    disconnect();
  });
});
