// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import {
  AUDIO_PLAYBACK_RATES,
  formatAudioPlaybackRate,
  getNextAudioPlaybackRate,
  applyAudioPlaybackRate,
} from "../lib/audio-playback-rate";

describe("audio-playback-rate", () => {
  it("lists exact playback rates 1, 1.5, 2, 2.5", () => {
    expect(AUDIO_PLAYBACK_RATES).toEqual([1, 1.5, 2, 2.5]);
  });

  it("cycles through 1x -> 1.5x -> 2.0x -> 2.5x -> 1x", () => {
    expect(getNextAudioPlaybackRate(1)).toBe(1.5);
    expect(getNextAudioPlaybackRate(1.5)).toBe(2);
    expect(getNextAudioPlaybackRate(2)).toBe(2.5);
    expect(getNextAudioPlaybackRate(2.5)).toBe(1);
  });

  it("formats playback rate labels cleanly", () => {
    expect(formatAudioPlaybackRate(1)).toBe("1x");
    expect(formatAudioPlaybackRate(1.5)).toBe("1.5x");
    expect(formatAudioPlaybackRate(2)).toBe("2.0x");
    expect(formatAudioPlaybackRate(2.5)).toBe("2.5x");
  });

  it("applies playbackRate, defaultPlaybackRate, and preservesPitch to audio element", () => {
    const fakeAudio: any = {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      preservesPitch: false,
    };

    applyAudioPlaybackRate(fakeAudio, 2.5);
    expect(fakeAudio.playbackRate).toBe(2.5);
    expect(fakeAudio.defaultPlaybackRate).toBe(2.5);
    expect(fakeAudio.preservesPitch).toBe(true);
  });
});
