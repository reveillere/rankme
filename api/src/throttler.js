import fetch from 'node-fetch';
import Bottleneck from 'bottleneck';

class QueueThrottler {
  constructor() {
    this.limiter = new Bottleneck({ maxConcurrent: 1, minTime: 200 });
  }

  async fetch(url) {
    return this.limiter.schedule(() => fetch(url));
  }
}

export default QueueThrottler;
