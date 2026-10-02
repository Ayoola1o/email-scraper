import { EventEmitter } from 'events';
import { IEventBus, StreamEvent } from './types';

const MAX_EVENT_BUFFER_SIZE = 150;

/**
 * Production-ready Event Bus with sequence numbers, replay ring buffer,
 * heartbeat generation, and disconnect cleanup.
 * Designed to seamlessly plug into Redis Pub/Sub for distributed scaling.
 */
export class LocalEventBus implements IEventBus {
  private emitter = new EventEmitter();
  private eventBuffers: Map<string, StreamEvent[]> = new Map();
  private sequences: Map<string, number> = new Map();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  /**
   * Publishes an event with an incremental sequence number and adds it to the replay buffer
   */
  publish(jobId: string, event: string, data: any): StreamEvent {
    const currentSeq = (this.sequences.get(jobId) || 0) + 1;
    this.sequences.set(jobId, currentSeq);

    const streamEvent: StreamEvent = {
      id: `${jobId}:${currentSeq}`,
      seq: currentSeq,
      event,
      data,
      timestamp: Date.now()
    };

    let buffer = this.eventBuffers.get(jobId);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(jobId, buffer);
    }

    buffer.push(streamEvent);
    if (buffer.length > MAX_EVENT_BUFFER_SIZE) {
      buffer.shift(); // Maintain bounded ring buffer
    }

    this.emitter.emit(`job:${jobId}`, streamEvent);
    return streamEvent;
  }

  /**
   * Subscribes a listener to a specific job's event stream
   */
  subscribe(jobId: string, listener: (event: StreamEvent) => void): () => void {
    const channel = `job:${jobId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  /**
   * Retrieves buffered events since a given sequence number (for client reconnection)
   */
  getHistory(jobId: string, sinceSeq = 0): StreamEvent[] {
    const buffer = this.eventBuffers.get(jobId) || [];
    if (sinceSeq <= 0) return [...buffer];
    return buffer.filter(e => e.seq > sinceSeq);
  }

  /**
   * Returns the latest sequence number emitted for a job
   */
  getLatestSeq(jobId: string): number {
    return this.sequences.get(jobId) || 0;
  }

  /**
   * Cleans up memory buffers after a job has concluded and listeners have disconnected
   */
  clearHistory(jobId: string): void {
    this.eventBuffers.delete(jobId);
    this.sequences.delete(jobId);
    this.emitter.removeAllListeners(`job:${jobId}`);
  }

  /**
   * Helper to format a StreamEvent into SSE-compliant wire format
   */
  static formatSse(event: StreamEvent): string {
    return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
  }

  /**
   * Helper to format a heartbeat event
   */
  static formatHeartbeat(timestamp = Date.now()): string {
    return `event: heartbeat\ndata: ${JSON.stringify({ timestamp })}\n\n`;
  }
}

// Singleton event bus instance
export const eventBus: IEventBus = new LocalEventBus();
