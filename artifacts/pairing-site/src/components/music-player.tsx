import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from './ui/button';

export function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ oscillators: OscillatorNode[]; gainNode: GainNode } | null>(null);

  const createAmbientSound = useCallback(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    ctxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.12, ctx.currentTime);
    masterGain.connect(ctx.destination);

    const oscillators: OscillatorNode[] = [];

    // Base drone — deep sub-bass pulse
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(55, ctx.currentTime);
    sub.frequency.linearRampToValueAtTime(58, ctx.currentTime + 4);
    sub.frequency.linearRampToValueAtTime(55, ctx.currentTime + 8);
    subGain.gain.setValueAtTime(0.5, ctx.currentTime);
    sub.connect(subGain);
    subGain.connect(masterGain);
    sub.start();
    oscillators.push(sub);

    // Mid harmonic — cyberpunk feel
    const mid = ctx.createOscillator();
    const midGain = ctx.createGain();
    mid.type = 'sawtooth';
    mid.frequency.setValueAtTime(110, ctx.currentTime);
    midGain.gain.setValueAtTime(0.06, ctx.currentTime);
    // Slow LFO filter effect via gain modulation
    const midLFO = ctx.createOscillator();
    const midLFOGain = ctx.createGain();
    midLFO.frequency.setValueAtTime(0.2, ctx.currentTime);
    midLFOGain.gain.setValueAtTime(0.04, ctx.currentTime);
    midLFO.connect(midLFOGain);
    midLFOGain.connect(midGain.gain);
    midLFO.start();
    mid.connect(midGain);
    midGain.connect(masterGain);
    mid.start();
    oscillators.push(mid, midLFO);

    // High shimmer — atmospheric texture
    const high = ctx.createOscillator();
    const highGain = ctx.createGain();
    high.type = 'sine';
    high.frequency.setValueAtTime(440, ctx.currentTime);
    high.frequency.linearRampToValueAtTime(523, ctx.currentTime + 6);
    high.frequency.linearRampToValueAtTime(440, ctx.currentTime + 12);
    highGain.gain.setValueAtTime(0.03, ctx.currentTime);
    high.connect(highGain);
    highGain.connect(masterGain);
    high.start();
    oscillators.push(high);

    // Pulse beat — electronic rhythmic element
    const pulse = ctx.createOscillator();
    const pulseGain = ctx.createGain();
    pulse.type = 'square';
    pulse.frequency.setValueAtTime(165, ctx.currentTime);
    pulseGain.gain.setValueAtTime(0, ctx.currentTime);
    // Rhythmic pulsing
    const now = ctx.currentTime;
    for (let i = 0; i < 200; i++) {
      const t = now + i * 0.5;
      pulseGain.gain.setValueAtTime(0.04, t);
      pulseGain.gain.linearRampToValueAtTime(0, t + 0.1);
    }
    pulse.connect(pulseGain);
    pulseGain.connect(masterGain);
    pulse.start();
    oscillators.push(pulse);

    nodesRef.current = { oscillators, gainNode: masterGain };
    return { oscillators, gainNode: masterGain };
  }, []);

  const stopAmbientSound = useCallback(() => {
    if (nodesRef.current) {
      nodesRef.current.oscillators.forEach(osc => {
        try { osc.stop(); } catch {}
      });
      nodesRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close();
      ctxRef.current = null;
    }
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      stopAmbientSound();
      setIsPlaying(false);
    } else {
      createAmbientSound();
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    return () => {
      stopAmbientSound();
    };
  }, [stopAmbientSound]);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Button
        variant="outline"
        size="icon"
        onClick={togglePlay}
        className="rounded-full bg-black/50 border-primary/50 text-primary hover:bg-primary/20 hover:text-primary transition-all duration-300 neon-border"
        title={isPlaying ? "Mute Music" : "Play Music"}
      >
        {isPlaying ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
      </Button>
    </div>
  );
}
