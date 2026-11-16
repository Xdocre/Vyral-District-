#!/usr/bin/env python3
"""
Vyral District video audio: voiceover (Kokoro TTS), synthesized music bed and
transition whooshes. Writes, per video:
  videos/build/<id>/audio.wav      final mix
  videos/build/<id>/timeline.json  scene start/end times used by the animator

Usage: python3 videos/audio.py --model kokoro.onnx --voices voices.bin [--only pv-01]
"""
import argparse, json, os, re
import numpy as np
import soundfile as sf

SR = 24000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def music_bed(seconds, bpm=124, seed=7):
    """Punchy, royalty-free synthesized beat: kick, clap, hats, sub bass, pad."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    out = np.zeros(n)
    beat = 60 / bpm
    t_kick = np.arange(int(0.35 * SR)) / SR
    kick = np.sin(2 * np.pi * (45 + 110 * np.exp(-t_kick * 28)) * t_kick) * np.exp(-t_kick * 9)
    t_clap = np.arange(int(0.2 * SR)) / SR
    clap = rng.normal(0, 1, len(t_clap)) * np.exp(-t_clap * 26)
    t_hat = np.arange(int(0.05 * SR)) / SR
    hat = np.diff(rng.normal(0, 1, len(t_hat) + 1)) * np.exp(-t_hat * 90)
    roots = [55.0, 55.0, 43.65, 49.0]  # A, A, F, G
    chords = [[220, 261.6, 329.6], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]

    def add(sig, start, gain):
        i = int(start * SR)
        if i >= n:
            return
        j = min(n, i + len(sig))
        out[i:j] += sig[: j - i] * gain

    step = 0
    t = 0.0
    while t < seconds:
        bar = int(step // 16) % 4
        s16 = step % 16
        if s16 in (0, 6, 8, 11):
            add(kick, t, 0.9)
        if s16 in (4, 12):
            add(clap, t, 0.35)
        add(hat, t, 0.18 if s16 % 2 == 0 else 0.1)
        if s16 % 4 == 0:  # sub bass on quarters
            tb = np.arange(int(beat * SR)) / SR
            add(np.sin(2 * np.pi * roots[bar] * tb) * np.exp(-tb * 3), t, 0.35)
        if s16 == 0:  # pad per bar
            tp = np.arange(int(beat * 4 * SR)) / SR
            env = np.minimum(1, tp * 4) * np.exp(-tp * 0.6)
            pad = sum(np.sin(2 * np.pi * f * tp) + 0.3 * np.sin(2 * np.pi * f * 2.003 * tp) for f in chords[bar])
            add(pad * env, t, 0.05)
        step += 1
        t += beat / 4
    return out


def whoosh(seed=3, dur=0.45):
    rng = np.random.default_rng(seed)
    tt = np.arange(int(dur * SR)) / SR
    noise = rng.normal(0, 1, len(tt))
    # crude rising band-pass via moving-average difference
    k = np.linspace(40, 4, len(tt)).astype(int)
    cs = np.cumsum(np.insert(noise, 0, 0))
    idx = np.arange(len(tt))
    lo = np.maximum(0, idx - k)
    smooth = (cs[idx + 1] - cs[lo]) / (idx + 1 - lo)
    env = np.sin(np.pi * tt / dur) ** 2
    return smooth * env * 1.6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--only")
    a = ap.parse_args()

    from kokoro_onnx import Kokoro

    tts = Kokoro(a.model, a.voices)
    spec = json.load(open(os.path.join(ROOT, "data", "videos.json")))
    vcfg = spec["voice"]

    for video in spec["videos"]:
        if a.only and video["id"] != a.only:
            continue
        out_dir = os.path.join(ROOT, "videos", "build", video["id"])
        os.makedirs(out_dir, exist_ok=True)

        lead_in = 0.35
        gap = 0.35
        t = lead_in
        voice_parts, scenes = [], []
        for i, sc in enumerate(video["scenes"]):
            samples, sr = tts.create(sc["vo"], voice=vcfg["voice"], speed=vcfg["speed"], lang="en-us")
            assert sr == SR
            samples = np.trim_zeros(np.asarray(samples), "fb")
            dur = len(samples) / SR
            is_last = i == len(video["scenes"]) - 1
            length = max(dur + gap, sc.get("min", 1.6)) + (1.6 if is_last else 0)
            voice_parts.append((t, samples))
            scenes.append({**sc, "start": round(t - (lead_in if i == 0 else 0), 3), "voStart": round(t, 3), "voEnd": round(t + dur, 3), "end": round(t + length, 3)})
            t += length

        total = t
        scenes[0]["start"] = 0.0
        n = int(total * SR)
        voice = np.zeros(n)
        for start, s in voice_parts:
            i = int(start * SR)
            voice[i : i + len(s)] += s[: n - i]

        # sidechain-style ducking: music dips while the voice talks
        env = np.convolve(np.abs(voice), np.ones(int(0.12 * SR)) / int(0.12 * SR), mode="same")
        duck = 1 - 0.55 * np.clip(env / (env.max() + 1e-9) * 4, 0, 1)
        music = music_bed(total) * duck
        fade = np.minimum(1, np.minimum(np.arange(n) / (0.3 * SR), (n - np.arange(n)) / (0.8 * SR)))
        music *= fade

        fx = np.zeros(n)
        w = whoosh()
        for sc in scenes[1:]:
            i = max(0, int((sc["start"] - 0.2) * SR))
            fx[i : i + len(w)] += w[: n - i]

        mix = voice / (np.abs(voice).max() + 1e-9) * 0.9 + music / (np.abs(music).max() + 1e-9) * 0.22 + fx * 0.12
        mix = np.tanh(mix * 1.1) * 0.95  # soft limiter
        sf.write(os.path.join(out_dir, "audio.wav"), mix.astype(np.float32), SR)
        json.dump({"id": video["id"], "duration": round(total, 3), "scenes": scenes}, open(os.path.join(out_dir, "timeline.json"), "w"), indent=2)
        print(f"{video['id']}: {total:.1f}s, {len(scenes)} scenes")


if __name__ == "__main__":
    main()
