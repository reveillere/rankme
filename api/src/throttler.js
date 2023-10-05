import fetch from 'node-fetch';

class QueueThrottler {
  constructor() {
    this.queue = [];
  }

  async processQueue() {
    if (this.queue.length) {
      const { request, resolve, reject } = this.queue.shift();

      try {
        const response = await request();

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After'), 10) * 1000; 
          console.error(`Too many requests to ${request}, retrying in ${retryAfter}ms...`);
          setTimeout(() => {
            this.queue.unshift({ request, resolve, reject }); 
            this.processQueue();
          }, retryAfter);
        } else {
          resolve(response);
        }
      } catch (error) {
        reject(error);
      }

      this.processQueue();
    }
  }

  addRequestToQueue(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processQueue();
    });
  }

  fetch(url) {
    return this.addRequestToQueue(() => fetch(url));
  }
}

export default QueueThrottler;
