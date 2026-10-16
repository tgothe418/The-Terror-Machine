import { Response } from 'express';

export class SseStream {
  private res: Response;
  private eventId: number = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private isClosed: boolean = false;

  constructor(res: Response) {
    this.res = res;
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    this.startHeartbeat();
  }

  public send(event: string, data: unknown): void {
    if (this.isClosed) return;
    this.eventId++;
    this.res.write(`id: ${this.eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  public sendToken(token: string): void {
    this.send('token', { token });
  }

  public complete(payload: unknown): void {
    if (this.isClosed) return;
    this.send('complete', payload);
    this.close();
  }

  public error(error: string, diagnostics?: unknown, code?: string): void {
    if (this.isClosed) return;
    this.send('error', { error, code, diagnostics });
    this.close();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.isClosed) {
        this.res.write(': heartbeat\n\n');
      }
    }, 15000);
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.res.end();
  }
}
