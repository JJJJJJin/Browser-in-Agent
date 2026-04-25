import type { BaseAction } from '../actions/BaseAction.js';

export type EnqueuedJob = {
  jobId: string;
  sessionId: string;
  actions: BaseAction[];
  createdAt: string;
};

export class ActionQueue {
  private q: EnqueuedJob[] = [];

  enqueue(job: EnqueuedJob) {
    this.q.push(job);
  }

  dequeue(): EnqueuedJob | undefined {
    return this.q.shift();
  }

  size() {
    return this.q.length;
  }
}

