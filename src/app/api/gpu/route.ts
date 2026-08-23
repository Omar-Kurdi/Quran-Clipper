import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'active',
    recommendedGpu: 'Any modern discrete or integrated GPU',
    supportedEncoders: ['MediaRecorder WebM VP9 / Opus', 'MediaRecorder WebM VP8 / Opus'],
    targetMaxFps: 60,
    targetMaxResolution: '3840x2160 (4K)',
    recommendedBitrateKbps: 18000,
    webcodecsAcceleration: true,
    audioSyncEngine: 'Web Audio API Destination Node'
  });
}
