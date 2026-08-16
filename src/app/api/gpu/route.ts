import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'active',
    recommendedGpu: 'NVIDIA GeForce RTX 5080 / Modern GPU',
    supportedEncoders: ['WebCodecs H.264 / AVC', 'WebM VP9 / AV1', 'Canvas2D WebGL GPU Acceleration', 'NVENC Hardware Acceleration'],
    targetMaxFps: 60,
    targetMaxResolution: '3840x2160 (4K)',
    recommendedBitrateKbps: 18000,
    webcodecsAcceleration: true,
    audioSyncEngine: 'Web Audio API Destination Node'
  });
}
