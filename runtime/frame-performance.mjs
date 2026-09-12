// Optional diagnostics. Work time includes synchronous host/GL calls made
// inside Scheduler.step; it is NOT a GPU timer or pure guest-CPU measurement.
export class FramePerformance {
  constructor({time, frame = 0, calls = 0, batches = 0, submitMs = 0}) {
    this.time = time; this.frame = frame; this.calls = calls; this.batches = batches; this.workMs = 0;
    this.submitMs = submitMs;
  }
  addWork(ms) { if (Number.isFinite(ms) && ms >= 0) this.workMs += ms; }
  sample({time, frame, calls, batches, submitMs = 0}) {
    const elapsed = time - this.time, frames = frame - this.frame;
    if (elapsed < 1000 || frames <= 0) return null;
    const result = {frames, elapsedMs: elapsed, fps: frames * 1000 / elapsed, workMs: this.workMs / frames,
      submitMs: (submitMs - this.submitMs) / frames,
      drawCalls: (calls - this.calls) / frames, batches: (batches - this.batches) / frames};
    this.time = time; this.frame = frame; this.calls = calls; this.batches = batches; this.workMs = 0;
    this.submitMs = submitMs;
    return result;
  }
}
