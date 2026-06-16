/** Минимальные типы WebTransport API (не во всех lib.dom). */
interface WebTransportCloseInfo {
  closeCode?: number;
  reason?: string;
}

interface WebTransportDatagramDuplexStream {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

interface WebTransportOptions {
  allowPooling?: boolean;
  serverCertificateHashes?: Array<{ algorithm: string; value: BufferSource }>;
}

interface WebTransport {
  readonly ready: Promise<void>;
  readonly closed: Promise<WebTransportCloseInfo>;
  readonly datagrams: WebTransportDatagramDuplexStream;
  close(closeInfo?: WebTransportCloseInfo): void;
}

declare const WebTransport: {
  prototype: WebTransport;
  new (url: string | URL, options?: WebTransportOptions): WebTransport;
} | undefined;
