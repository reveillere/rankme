import fetch from 'node-fetch';
import Bottleneck from 'bottleneck';

class QueueThrottler {
  constructor() {
    this.queue = [];

    // Créer des limiters spécifiques pour chaque domaine
    this.limiters = {
      'dblp.org': new Bottleneck({ maxConcurrent: 1, minTime: 100 }),
      'portal.core.edu.au': new Bottleneck({ maxConcurrent: 1, minTime: 100 }),
    };
  }

  getLimiterForURL(url) {
    for (const domain in this.limiters) {
      if (url.includes(domain)) {
        return this.limiters[domain];
      }
    }
    // Si aucun domaine correspondant n'est trouvé, retourner une instance sans restriction
    return new Bottleneck({ maxConcurrent: 1000, minTime: 0 });
  }

  async processQueue() {
    if (this.queue.length) {
      const { request, resolve, reject } = this.queue.shift();
      const limiter = this.getLimiterForURL(request.url);

      limiter.schedule(async () => {
        try {
          const response = await request();

          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After'), 10) * 1000;
            console.error(`Too many requests to ${request.url}, retrying in ${retryAfter}ms...`);
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
      });
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
