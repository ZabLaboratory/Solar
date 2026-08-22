/**
 * Starts late-attached live videos without changing the host's audio policy.
 *
 * Solar's runtime owns the `liveAudio` decision. Interactive hosts remain
 * muted, while broadcast hosts may keep audio enabled. The helper only mutes
 * when the caller explicitly requests the muted policy and restores the
 * previous state when the Solar mount is disconnected.
 */
export function installLiveVideoAutoplay(liveAudio: boolean): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }

  const attached = new Map<
    HTMLVideoElement,
    { previousMuted: boolean; onReady: () => void }
  >();

  const start = (video: HTMLVideoElement): void => {
    if (!liveAudio) video.muted = true;
    if (!video.srcObject || !video.paused) return;
    void video.play().catch(() => {
      // A later canplay/loadedmetadata event retries after the track becomes
      // decodable. Autoplay rejection is not a scene transport failure.
    });
  };

  const attach = (video: HTMLVideoElement): void => {
    if (attached.has(video)) return;
    const onReady = (): void => start(video);
    attached.set(video, { previousMuted: video.muted, onReady });
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    start(video);
  };

  const scan = (): void => {
    document
      .querySelectorAll<HTMLVideoElement>("video[data-lumencast-media-live]")
      .forEach(attach);
  };

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  return () => {
    observer.disconnect();
    for (const [video, state] of attached) {
      video.removeEventListener("loadedmetadata", state.onReady);
      video.removeEventListener("canplay", state.onReady);
      video.muted = state.previousMuted;
    }
    attached.clear();
  };
}
