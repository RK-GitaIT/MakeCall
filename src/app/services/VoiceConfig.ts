export const VoiceConfig = {
    // The intended sample rate of the encoded audio (and for decoding)
    intendedSampleRate: 32000,
    // The sample rate at which your AudioContext will run.
    // (You may choose 48000 if you require that elsewhere, but for perfect sync using the intended rate,
    // you might also use the intended sample rate.)
    audioContextSampleRate: 32000,
    // Outbound mic settings.
    outboundMic: {
      sampleRate: 48000,
      bufferSize: 2048,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    },
    // A helper to compute the playback rate adjustment so that audio plays at the intended speed.
    getPlaybackRateAdjustment(audioCtxSampleRate: number): number {
      return this.intendedSampleRate / audioCtxSampleRate;
    }
  };
  