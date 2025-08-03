#[cfg(test)]
pub mod test_helpers {
    use cosmwasm_std::{
        testing::{MockApi, MockQuerier, MockStorage},
        Addr, Binary, Empty, Env,
        IbcAcknowledgement, IbcChannel, IbcChannelOpenMsg, 
        IbcPacket, IbcPacketAckMsg, IbcPacketReceiveMsg, IbcPacketTimeoutMsg,
        MessageInfo, OwnedDeps,
    };
    use std::marker::PhantomData;

    /// Mock IBC-enabled dependencies
    pub fn mock_ibc_deps() -> OwnedDeps<MockStorage, MockApi, MockQuerier, Empty> {
        OwnedDeps {
            storage: MockStorage::default(),
            api: MockApi::default(),
            querier: MockQuerier::new(&[]),
            custom_query_type: PhantomData,
        }
    }

    /// Mock IBC channel for testing
    pub fn mock_ibc_channel(_channel_id: &str, _port_id: &str) -> IbcChannel {
        // Note: IbcChannel doesn't have a public constructor
        // This is a limitation of the current cosmwasm-std
        // In real tests, these come from the framework
        panic!("IbcChannel cannot be constructed in tests - use framework mocks")
    }

    /// Mock IBC packet for testing
    pub fn mock_ibc_packet(
        _src_channel: &str,
        _dest_channel: &str,
        _data: Binary,
        _sequence: u64,
        _timeout_seconds: u64,
    ) -> IbcPacket {
        // Note: IbcPacket doesn't have a public constructor
        panic!("IbcPacket cannot be constructed in tests - use framework mocks")
    }

    /// Mock IBC channel open message
    pub fn mock_ibc_channel_open_msg(
        channel: IbcChannel,
        counterparty_version: Option<String>,
    ) -> IbcChannelOpenMsg {
        if let Some(version) = counterparty_version {
            IbcChannelOpenMsg::OpenTry {
                channel,
                counterparty_version: version,
            }
        } else {
            IbcChannelOpenMsg::OpenInit { channel }
        }
    }


    /// Mock IBC packet receive message
    pub fn mock_ibc_packet_receive_msg(
        packet: IbcPacket,
        relayer: &str,
    ) -> IbcPacketReceiveMsg {
        IbcPacketReceiveMsg::new(packet, Addr::unchecked(relayer))
    }

    /// Mock IBC packet ack message
    pub fn mock_ibc_packet_ack_msg(
        packet: IbcPacket,
        acknowledgement: Binary,
        relayer: &str,
    ) -> IbcPacketAckMsg {
        IbcPacketAckMsg::new(IbcAcknowledgement::new(acknowledgement), packet, Addr::unchecked(relayer))
    }

    /// Mock IBC packet timeout message
    pub fn mock_ibc_packet_timeout_msg(
        packet: IbcPacket,
        relayer: &str,
    ) -> IbcPacketTimeoutMsg {
        IbcPacketTimeoutMsg::new(packet, Addr::unchecked(relayer))
    }
}