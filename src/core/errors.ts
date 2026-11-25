export class TransportFailedError extends Error {
  readonly instanceId: string;
  readonly epoch: number;

  constructor(message: string, instanceId: string, epoch: number) {
    super(message);
    this.name = "TransportFailedError";
    this.instanceId = instanceId;
    this.epoch = epoch;
  }
}

export class AbortRunError extends Error {
  readonly instanceId: string;
  readonly epoch: number;

  constructor(message: string, instanceId: string, epoch: number) {
    super(message);
    this.name = "AbortRunError";
    this.instanceId = instanceId;
    this.epoch = epoch;
  }
}
