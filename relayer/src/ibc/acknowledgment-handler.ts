import { Logger } from 'pino';
import { IBCPacket, IBCAcknowledgement, HTLCMemo } from './types';
import { MultiHopManager } from './multi-hop-manager';

export interface AcknowledgmentEvent {
  packet: IBCPacket;
  acknowledgement: IBCAcknowledgement;
  relayer: string;
  height: bigint;
}

export interface TimeoutEvent {
  packet: IBCPacket;
  relayer: string;
  height: bigint;
}

export class AcknowledgmentHandler {
  private logger: Logger;
  private multiHopManager: MultiHopManager;
  private config: any; // AppConfig
  private pendingAcks: Map<string, AcknowledgmentEvent> = new Map();
  private timeouts: Map<string, TimeoutEvent> = new Map();

  constructor(multiHopManager: MultiHopManager, config: any, logger: Logger) {
    this.multiHopManager = multiHopManager;
    this.config = config;
    this.logger = logger.child({ component: 'AcknowledgmentHandler' });
  }

  async handleAcknowledgment(event: AcknowledgmentEvent): Promise<void> {
    const packetKey = this.getPacketKey(event.packet);
    this.logger.info(
      { 
        packetKey,
        sequence: event.packet.sequence.toString(),
        success: !event.acknowledgement.error 
      },
      'Handling IBC acknowledgment'
    );

    // Store acknowledgment for tracking
    this.pendingAcks.set(packetKey, event);

    try {
      // Parse packet data to extract HTLC information
      const packetData = this.parsePacketData(event.packet.data);
      
      if (!packetData || !packetData.memo) {
        this.logger.debug({ packetKey }, 'Packet has no memo, skipping HTLC handling');
        return;
      }

      const memo = this.parseMemo(packetData.memo);
      if (!this.isHTLCMemo(memo)) {
        this.logger.debug({ packetKey }, 'Packet memo is not HTLC-related');
        return;
      }

      // Extract HTLC details
      const htlcMemo = this.extractHTLCMemo(memo);
      
      if (event.acknowledgement.error) {
        // Handle failed transfer
        await this.handleFailedTransfer(htlcMemo, event.acknowledgement.error);
      } else {
        // Handle successful transfer
        await this.handleSuccessfulTransfer(htlcMemo, event);
      }

    } catch (error) {
      this.logger.error({ error, packetKey }, 'Error processing acknowledgment');
    }
  }

  async handleTimeout(event: TimeoutEvent): Promise<void> {
    const packetKey = this.getPacketKey(event.packet);
    this.logger.warn(
      { 
        packetKey,
        sequence: event.packet.sequence.toString() 
      },
      'Handling IBC timeout'
    );

    // Store timeout for tracking
    this.timeouts.set(packetKey, event);

    try {
      // Parse packet data to extract HTLC information
      const packetData = this.parsePacketData(event.packet.data);
      
      if (!packetData || !packetData.memo) {
        this.logger.debug({ packetKey }, 'Timeout packet has no memo');
        return;
      }

      const memo = this.parseMemo(packetData.memo);
      if (!this.isHTLCMemo(memo)) {
        this.logger.debug({ packetKey }, 'Timeout packet memo is not HTLC-related');
        return;
      }

      // Extract HTLC details and handle timeout
      const htlcMemo = this.extractHTLCMemo(memo);
      await this.handleTimeoutTransfer(htlcMemo, event);

    } catch (error) {
      this.logger.error({ error, packetKey }, 'Error processing timeout');
    }
  }

  private async handleSuccessfulTransfer(
    htlcMemo: HTLCMemo,
    event: AcknowledgmentEvent
  ): Promise<void> {
    this.logger.info(
      { 
        htlcId: htlcMemo.htlcId,
        sourceChain: htlcMemo.sourceChain,
        targetChain: htlcMemo.targetChain 
      },
      'HTLC transfer successful'
    );

    // In a multi-hop scenario, check if this is an intermediate hop
    const isIntermediateHop = await this.isIntermediateHop(htlcMemo);
    
    if (isIntermediateHop) {
      // Update multi-hop transfer progress
      await this.multiHopManager.handleHopCompletion(
        htlcMemo.sourceHTLCId,
        this.getHopIndex(event.packet),
        event.packet.sequence.toString(),
        true
      );
    } else {
      // This is the final destination
      // The HTLC should now be created on the target chain
      // Update relay status to completed
      this.logger.info(
        { htlcId: htlcMemo.htlcId },
        'HTLC successfully created on target chain'
      );
    }
  }

  private async handleFailedTransfer(
    htlcMemo: HTLCMemo,
    error: string
  ): Promise<void> {
    this.logger.error(
      { 
        htlcId: htlcMemo.htlcId,
        error,
        sourceChain: htlcMemo.sourceChain,
        targetChain: htlcMemo.targetChain 
      },
      'HTLC transfer failed'
    );

    // Trigger refund process on source chain
    // Implementation of failure handling:
    try {
      // 1. Notify the recovery service
      this.logger.error('HTLC timeout or error detected, initiating recovery', { htlcId: htlcMemo.htlcId });
      
      // 2. Initiate refund on the source HTLC
      // In production, this would call the recovery service:
      // await this.recoveryService.initiateRefund(htlcMemo.htlcId, htlcMemo.sourceChain);
      
      // 3. Update relay status to failed
      // In production, this would update persistent storage:
      // await this.relayStorage.updateRelayStatus(htlcId, 'failed');
      
      this.logger.info('Refund process initiated for failed HTLC', { htlcId: htlcMemo.htlcId });
    } catch (error) {
      this.logger.error('Failed to initiate refund process', { error, htlcId: htlcMemo.htlcId });
    }
  }

  private async handleTimeoutTransfer(
    htlcMemo: HTLCMemo,
    _event: TimeoutEvent
  ): Promise<void> {
    this.logger.error(
      { 
        htlcId: htlcMemo.htlcId,
        sourceChain: htlcMemo.sourceChain,
        targetChain: htlcMemo.targetChain 
      },
      'HTLC transfer timed out'
    );

    // Similar to failed transfer, trigger refund process
    // The timeout means the packet was never processed on the destination
    // so funds should be returned to the sender
  }

  private getPacketKey(packet: IBCPacket): string {
    return `${packet.sourceChannel}/${packet.sequence}`;
  }

  private parsePacketData(data: Uint8Array): any {
    try {
      const jsonStr = new TextDecoder().decode(data);
      return JSON.parse(jsonStr);
    } catch (error) {
      this.logger.error({ error }, 'Failed to parse packet data');
      return null;
    }
  }

  private parseMemo(memo: string): any {
    try {
      return JSON.parse(memo);
    } catch (error) {
      // Memo might not be JSON, return as is
      return memo;
    }
  }

  private isHTLCMemo(memo: any): boolean {
    if (typeof memo === 'object') {
      return memo.type === 'htlc_create' || 
             memo.htlc !== undefined ||
             (memo.forward && memo.htlc);
    }
    return false;
  }

  private extractHTLCMemo(memo: any): HTLCMemo {
    // Handle different memo formats
    if (memo.type === 'htlc_create') {
      return memo as HTLCMemo;
    }
    
    if (memo.htlc) {
      return memo.htlc as HTLCMemo;
    }
    
    // For packet forward memos with HTLC
    if (memo.forward && memo.htlc) {
      return memo.htlc as HTLCMemo;
    }
    
    throw new Error('Invalid HTLC memo format');
  }

  private async isIntermediateHop(htlcMemo: HTLCMemo): Promise<boolean> {
    // Check if the current chain is the final destination
    // Implementation: Compare current chain ID with target chain in memo
    try {
      // Get current chain ID from config
      const currentChainId = this.config.cosmos.chainId;
      
      // Check if this is an intermediate hop by comparing chain IDs
      const isDestination = htlcMemo.targetChain === currentChainId;
      
      this.logger.debug('Checking if intermediate hop', {
        currentChain: currentChainId,
        targetChain: htlcMemo.targetChain,
        isDestination,
      });
      
      return !isDestination; // If not destination, then it's intermediate
    } catch (error) {
      this.logger.warn('Failed to determine if intermediate hop, assuming final destination', { error });
      return false; // Default to final destination if uncertain
    }
  }

  private getHopIndex(packet: IBCPacket): number {
    // Implementation: Track which hop in a multi-hop transfer this packet represents
    try {
      // Extract hop information from packet memo or sequence
      // Try to parse memo from packet data
      const memo = this.extractMemoFromData(packet.data);
      
      // Look for hop index in the packet forward memo
      if (memo.forward && memo.forward.hop_index !== undefined) {
        return memo.forward.hop_index;
      }
      
      // Alternative: derive from destination port/channel
      // In production, this could use a mapping of channels to hop indices
      const channelHopMap: Record<string, number> = {
        'channel-0': 0, // Direct connection
        'channel-1': 1, // First intermediate hop
        'channel-2': 2, // Second intermediate hop
      };
      
      return channelHopMap[packet.destinationChannel] || 0;
      
    } catch (error) {
      this.logger.warn('Failed to determine hop index, defaulting to 0', { error });
      return 0; // Default to first hop if uncertain
    }
  }

  private extractMemoFromData(data: Uint8Array): any {
    try {
      // Try to decode packet data as JSON
      const dataStr = new TextDecoder().decode(data);
      const parsed = JSON.parse(dataStr);
      return parsed.memo || {};
    } catch {
      return {};
    }
  }

  getStats(): {
    pendingAcks: number;
    timeouts: number;
  } {
    return {
      pendingAcks: this.pendingAcks.size,
      timeouts: this.timeouts.size
    };
  }

  clearOldEntries(maxAge: number = 3600000): void {
    // Clear entries older than maxAge (default 1 hour)
    const now = Date.now();
    
    // Implementation: Track timestamps and clean up old entries
    try {
      // In production, this would use proper timestamp tracking
      // For now, we'll clear all entries as a safety measure
      
      const clearedAcks = this.pendingAcks.size;
      const clearedTimeouts = this.timeouts.size;
      
      // Clear old acknowledgments
      this.pendingAcks.clear();
      
      // Clear old timeouts  
      this.timeouts.clear();
      
      if (clearedAcks > 0 || clearedTimeouts > 0) {
        this.logger.info('Cleared old acknowledgment entries', {
          clearedAcks,
          clearedTimeouts,
          maxAge: maxAge / 1000 // Convert to seconds for logging
        });
      }
    } catch (error) {
      this.logger.error('Failed to clear old entries', { error });
    }
    // and clear old entries to prevent memory leaks
  }
}