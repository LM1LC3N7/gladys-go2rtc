// -----------------------------------------------------------------------------
// At most N tasks at a time, the others wait in order. Each go2rtc snapshot
// starts an ffmpeg in go2rtc (and the sub-container has 100 PIDs): the
// requests that wake a camera go through one of these.
// -----------------------------------------------------------------------------

export class Limiter {
  constructor(max) {
    this.max = max;
    this.running = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  next() {
    while (this.running < this.max && this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
      this.running += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.running -= 1;
          this.next();
        });
    }
  }
}
