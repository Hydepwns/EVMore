import { FusionError, ErrorCode } from './base';

export class IBCError extends FusionError {
  constructor(
    code: ErrorCode,
    message: string,
    public readonly channelId: string,
    public readonly sourceChainId: string,
    public readonly destChainId: string,
    details?: Record<string, any>
  ) {
    super(code, message, { channelId, sourceChainId, destChainId, ...details });
  }
}

export class IBCChannelClosedError extends IBCError {
  constructor(
    channelId: string,
    sourceChainId: string,
    destChainId: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.IBC_CHANNEL_CLOSED,
      `IBC channel ${channelId} is closed between ${sourceChainId} and ${destChainId}`,
      channelId,
      sourceChainId,
      destChainId,
      details
    );
  }
}

export class IBCTimeoutError extends IBCError {
  constructor(
    channelId: string,
    sourceChainId: string,
    destChainId: string,
    packetSequence: number,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.IBC_TIMEOUT,
      `IBC packet timeout on channel ${channelId} from ${sourceChainId} to ${destChainId}, sequence: ${packetSequence}`,
      channelId,
      sourceChainId,
      destChainId,
      { packetSequence, ...details }
    );
  }
}

export class IBCPacketFailedError extends IBCError {
  constructor(
    channelId: string,
    sourceChainId: string,
    destChainId: string,
    reason: string,
    details?: Record<string, any>
  ) {
    super(
      ErrorCode.IBC_PACKET_FAILED,
      `IBC packet failed on channel ${channelId}: ${reason}`,
      channelId,
      sourceChainId,
      destChainId,
      { reason, ...details }
    );
  }
}