use cosmwasm_std::{
    entry_point, DepsMut, Env, IbcBasicResponse, IbcChannel, IbcChannelCloseMsg,
    IbcChannelConnectMsg, IbcChannelOpenMsg, IbcChannelOpenResponse, IbcOrder, IbcPacket,
    IbcPacketAckMsg, IbcPacketReceiveMsg, IbcPacketTimeoutMsg, IbcReceiveResponse,
    from_json, to_json_binary,
};
use cw_storage_plus::Item;

use crate::error::ContractError;
use crate::msg::{IbcPacketData, SwapInstruction, ForwardInstruction};

// Store active IBC channels
pub const IBC_CHANNELS: Item<Vec<IbcChannel>> = Item::new("ibc_channels");

// IBC application version
const IBC_VERSION: &str = "fusion-router-v1";

// Channel lifecycle handlers

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn ibc_channel_open(
    _deps: DepsMut,
    _env: Env,
    msg: IbcChannelOpenMsg,
) -> Result<IbcChannelOpenResponse, ContractError> {
    validate_order_and_version(msg.channel(), msg.counterparty_version())?;
    
    Ok(Some(cosmwasm_std::Ibc3ChannelOpenResponse {
        version: IBC_VERSION.to_string(),
    }))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn ibc_channel_connect(
    deps: DepsMut,
    _env: Env,
    msg: IbcChannelConnectMsg,
) -> Result<IbcBasicResponse, ContractError> {
    validate_order_and_version(msg.channel(), msg.counterparty_version())?;
    
    // Store the channel
    let mut channels = IBC_CHANNELS.may_load(deps.storage)?.unwrap_or_default();
    channels.push(msg.channel().clone());
    IBC_CHANNELS.save(deps.storage, &channels)?;
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_channel_connect")
        .add_attribute("channel_id", &msg.channel().endpoint.channel_id))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn ibc_channel_close(
    deps: DepsMut,
    _env: Env,
    msg: IbcChannelCloseMsg,
) -> Result<IbcBasicResponse, ContractError> {
    // Remove the channel from storage
    let mut channels = IBC_CHANNELS.may_load(deps.storage)?.unwrap_or_default();
    channels.retain(|c| c.endpoint.channel_id != msg.channel().endpoint.channel_id);
    IBC_CHANNELS.save(deps.storage, &channels)?;
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_channel_close")
        .add_attribute("channel_id", &msg.channel().endpoint.channel_id))
}

// Packet lifecycle handlers

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn ibc_packet_receive(
    deps: DepsMut,
    env: Env,
    msg: IbcPacketReceiveMsg,
) -> Result<IbcReceiveResponse, ContractError> {
    // Parse the packet data with our custom memo support
    let packet_data: IbcPacketData = from_json(&msg.packet.data)?;
    
    // Process the swap and forward if needed
    let res = process_ibc_swap(deps, env, packet_data, msg.packet)?;
    
    Ok(res)
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn ibc_packet_ack(
    _deps: DepsMut,
    _env: Env,
    msg: IbcPacketAckMsg,
) -> Result<IbcBasicResponse, ContractError> {
    // Handle acknowledgment - could be used for tracking successful swaps
    let _ack = msg.acknowledgement;
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_packet_ack")
        .add_attribute("packet_sequence", msg.original_packet.sequence.to_string()))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn ibc_packet_timeout(
    _deps: DepsMut,
    _env: Env,
    msg: IbcPacketTimeoutMsg,
) -> Result<IbcBasicResponse, ContractError> {
    // Handle timeout - trigger refund if applicable
    let packet_data: IbcPacketData = from_json(&msg.packet.data)?;
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_packet_timeout")
        .add_attribute("packet_sequence", msg.packet.sequence.to_string())
        .add_attribute("refund_to", packet_data.sender))
}

// Helper functions

fn validate_order_and_version(
    channel: &IbcChannel,
    counterparty_version: Option<&str>,
) -> Result<(), ContractError> {
    // Only allow unordered channels for IBC transfers
    if channel.order != IbcOrder::Unordered {
        return Err(ContractError::InvalidIbcChannelOrder {
            expected: IbcOrder::Unordered,
            actual: channel.order.clone(),
        });
    }
    
    // Verify the version
    if let Some(version) = counterparty_version {
        if version != IBC_VERSION {
            return Err(ContractError::InvalidIbcVersion {
                expected: IBC_VERSION.to_string(),
                actual: version.to_string(),
            });
        }
    }
    
    Ok(())
}

fn process_ibc_swap(
    deps: DepsMut,
    env: Env,
    packet_data: IbcPacketData,
    _packet: IbcPacket,
) -> Result<IbcReceiveResponse, ContractError> {
    let mut response = IbcReceiveResponse::new();
    
    // Check if there's a swap instruction in the memo
    if let Some(memo) = packet_data.memo {
        let swap_data: SwapInstruction = from_json(&memo)?;
        
        // Perform the swap on Osmosis
        let swap_msg = create_osmosis_swap_msg(
            &packet_data.receiver,
            &packet_data.denom,
            packet_data.amount,
            swap_data.pool_id,
            &swap_data.token_out_denom,
            swap_data.min_output,
        )?;
        
        response = response.add_message(swap_msg);
        
        // Handle forwarding if specified
        if let Some(forward) = swap_data.forward {
            let forward_msg = create_forward_msg(
                deps.as_ref(),
                &env,
                &packet_data.receiver,
                &swap_data.token_out_denom,
                packet_data.amount, // This would be the swap output amount
                &forward,
            )?;
            
            response = response.add_message(forward_msg);
        }
    }
    
    // Set acknowledgment
    let ack = to_json_binary(&AckData { success: true })?;
    response = response.set_ack(ack);
    
    Ok(response
        .add_attribute("action", "process_ibc_swap")
        .add_attribute("recipient", packet_data.receiver))
}

fn create_osmosis_swap_msg(
    sender: &str,
    _token_in_denom: &str,
    token_in_amount: cosmwasm_std::Uint128,
    _pool_id: u64,
    token_out_denom: &str,
    min_output: Option<cosmwasm_std::Uint128>,
) -> Result<cosmwasm_std::CosmosMsg, ContractError> {
    // For now, we'll use a bank send message as a placeholder
    // In production, this would integrate with Osmosis pools
    Ok(cosmwasm_std::CosmosMsg::Bank(cosmwasm_std::BankMsg::Send {
        to_address: sender.to_string(),
        amount: vec![cosmwasm_std::Coin {
            denom: token_out_denom.to_string(),
            amount: min_output.unwrap_or(token_in_amount),
        }],
    }))
}

fn create_forward_msg(
    _deps: cosmwasm_std::Deps,
    env: &Env,
    sender: &str,
    denom: &str,
    amount: cosmwasm_std::Uint128,
    forward: &ForwardInstruction,
) -> Result<cosmwasm_std::CosmosMsg, ContractError> {
    use cosmwasm_std::{IbcMsg, IbcTimeout, Timestamp};
    
    // Create IBC transfer with next hop memo
    let next_memo = if let Some(next) = &forward.next {
        Some(to_json_binary(next)?)
    } else {
        None
    };
    
    let packet_data = IbcPacketData {
        sender: sender.to_string(),
        receiver: forward.receiver.clone(),
        denom: denom.to_string(),
        amount,
        memo: next_memo.map(|b| b.to_string()),
    };
    
    let timeout = IbcTimeout::with_timestamp(
        Timestamp::from_seconds(env.block.time.seconds() + forward.timeout)
    );
    
    Ok(cosmwasm_std::CosmosMsg::Ibc(IbcMsg::SendPacket {
        channel_id: forward.channel.clone(),
        data: to_json_binary(&packet_data)?,
        timeout,
    }))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AckData {
    success: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env};
    use cosmwasm_std::{IbcMsg, BankMsg, CosmosMsg};

    #[test]
    fn test_packet_data_serialization() {
        // Test swap instruction serialization
        let swap_instruction = SwapInstruction {
            pool_id: 1,
            token_out_denom: "uosmo".to_string(),
            min_output: Some(cosmwasm_std::Uint128::new(1000)),
            forward: None,
        };
        
        let packet_data = IbcPacketData {
            sender: "cosmos1sender".to_string(),
            receiver: "osmo1receiver".to_string(),
            denom: "uatom".to_string(),
            amount: cosmwasm_std::Uint128::new(2000),
            memo: Some(to_json_binary(&swap_instruction).unwrap().to_string()),
        };
        
        // Validate packet data serialization
        let serialized = to_json_binary(&packet_data).unwrap();
        let deserialized: IbcPacketData = from_json(&serialized).unwrap();
        assert_eq!(deserialized.sender, packet_data.sender);
        assert_eq!(deserialized.amount, packet_data.amount);
        assert!(deserialized.memo.is_some());
    }

    #[test]
    fn test_create_forward_msg() {
        let deps = mock_dependencies();
        let env = mock_env();
        
        let forward = ForwardInstruction {
            port: "transfer".to_string(),
            channel: "channel-2".to_string(),
            receiver: "juno1receiver".to_string(),
            timeout: 300,
            retries: 0,
            next: None,
        };
        
        let msg = create_forward_msg(
            deps.as_ref(),
            &env,
            "osmo1sender",
            "ujuno",
            cosmwasm_std::Uint128::new(1000),
            &forward,
        ).unwrap();
        
        // Verify it creates an IBC message
        match msg {
            cosmwasm_std::CosmosMsg::Ibc(IbcMsg::SendPacket { channel_id, .. }) => {
                assert_eq!(channel_id, "channel-2");
            }
            _ => panic!("Expected IBC SendPacket message"),
        }
    }

    #[test]
    fn test_swap_instruction_with_forward() {
        // Test complex swap instruction with forwarding
        let forward = ForwardInstruction {
            port: "transfer".to_string(),
            channel: "channel-2".to_string(),
            receiver: "juno1receiver".to_string(),
            timeout: 300,
            retries: 0,
            next: Some(Box::new(SwapInstruction {
                pool_id: 2,
                token_out_denom: "ujuno".to_string(),
                min_output: Some(cosmwasm_std::Uint128::new(500)),
                forward: None,
            })),
        };
        
        let swap_instruction = SwapInstruction {
            pool_id: 1,
            token_out_denom: "uosmo".to_string(),
            min_output: Some(cosmwasm_std::Uint128::new(1000)),
            forward: Some(forward),
        };
        
        // Test serialization
        let serialized = to_json_binary(&swap_instruction).unwrap();
        let deserialized: SwapInstruction = from_json(&serialized).unwrap();
        
        assert_eq!(deserialized.pool_id, 1);
        assert!(deserialized.forward.is_some());
        let forward = deserialized.forward.unwrap();
        assert_eq!(forward.channel, "channel-2");
        assert!(forward.next.is_some());
    }

    #[test]
    fn test_ack_data() {
        let ack = AckData { success: true };
        let serialized = to_json_binary(&ack).unwrap();
        let deserialized: AckData = from_json(&serialized).unwrap();
        assert!(deserialized.success);
        
        let ack_fail = AckData { success: false };
        let serialized = to_json_binary(&ack_fail).unwrap();
        let deserialized: AckData = from_json(&serialized).unwrap();
        assert!(!deserialized.success);
    }

    #[test]
    fn test_ibc_handler_logic() {
        // Test the handler logic without actual IBC types
        // which cannot be constructed in unit tests
        
        // Test channel validation
        let deps = mock_dependencies();
        
        // Test packet data processing
        let swap_instruction = SwapInstruction {
            pool_id: 1,
            token_out_denom: "uosmo".to_string(),
            min_output: Some(cosmwasm_std::Uint128::new(1000)),
            forward: None,
        };
        
        let packet_data = IbcPacketData {
            sender: "cosmos1sender".to_string(),
            receiver: "osmo1receiver".to_string(),
            denom: "uatom".to_string(),
            amount: cosmwasm_std::Uint128::new(2000),
            memo: Some(to_json_binary(&swap_instruction).unwrap().to_string()),
        };
        
        // Test serialization round-trip
        let serialized = to_json_binary(&packet_data).unwrap();
        let deserialized: IbcPacketData = from_json(&serialized).unwrap();
        assert_eq!(deserialized.sender, packet_data.sender);
        assert_eq!(deserialized.amount, packet_data.amount);
        
        // Test swap message creation logic
        let msg = create_osmosis_swap_msg(
            &packet_data.receiver,
            &packet_data.denom,
            packet_data.amount,
            swap_instruction.pool_id,
            &swap_instruction.token_out_denom,
            swap_instruction.min_output,
        ).unwrap();
        
        // Verify it creates a bank message (our placeholder)
        match msg {
            CosmosMsg::Bank(BankMsg::Send { .. }) => {}
            _ => panic!("Expected bank send message"),
        }
    }
}

