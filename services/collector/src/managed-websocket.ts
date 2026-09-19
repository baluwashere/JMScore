import WebSocket from 'ws';

export interface SocketStatus {
  name: string;
  connected: boolean;
  changedAt: number;
  reason?: string;
}

interface ManagedWebSocketOptions {
  name: string;
  url: string;
  staleAfterMs: number;
  onMessage: (payload: string) => void;
  onStatus: (status: SocketStatus) => void;
  onError: (message: string) => void;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
}

export class ManagedWebSocket {
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;

  constructor(private readonly options: ManagedWebSocketOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.watchdogTimer = setInterval(() => this.watchdog(), 5_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.reconnectTimer = null;
    this.watchdogTimer = null;

    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(1000, 'collector shutdown');
    }
  }

  private connect(): void {
    if (this.stopped) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url, {
        perMessageDeflate: false,
        handshakeTimeout: 10_000,
      });
    } catch (error) {
      this.options.onError(`${this.options.name}: websocket construction failed: ${String(error)}`);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.on('open', () => {
      if (socket !== this.socket || this.stopped) return;
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.options.onStatus({
        name: this.options.name,
        connected: true,
        changedAt: Date.now(),
      });
    });

    socket.on('message', (data) => {
      if (socket !== this.socket || this.stopped) return;
      this.lastMessageAt = Date.now();
      this.options.onMessage(data.toString());
    });

    socket.on('error', (error) => {
      if (socket !== this.socket || this.stopped) return;
      this.options.onError(`${this.options.name}: ${error.message}`);
    });

    socket.on('close', (code, reasonBuffer) => {
      if (socket !== this.socket) return;
      this.socket = null;
      const reason = reasonBuffer.toString() || `code=${code}`;
      this.options.onStatus({
        name: this.options.name,
        connected: false,
        changedAt: Date.now(),
        reason,
      });
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    const base = this.options.baseReconnectMs ?? 500;
    const max = this.options.maxReconnectMs ?? 30_000;
    const exponent = Math.min(this.reconnectAttempt, 8);
    const rawDelay = Math.min(max, base * 2 ** exponent);
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(rawDelay * jitter);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private watchdog(): void {
    if (this.stopped || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.lastMessageAt === 0) return;

    const ageMs = Date.now() - this.lastMessageAt;
    if (ageMs <= this.options.staleAfterMs) return;

    this.options.onError(
      `${this.options.name}: no messages for ${ageMs}ms; terminating stale connection`,
    );
    this.socket.terminate();
  }
}
