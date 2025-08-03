"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORE_TOKENS = void 0;
exports.createServiceToken = createServiceToken;
// Helper function to create service tokens
function createServiceToken(name, description) {
    return { name, description };
}
// Built-in service tokens
exports.CORE_TOKENS = {
    Logger: createServiceToken('Logger', 'Application logger'),
    Config: createServiceToken('Config', 'Application configuration'),
    // Monitors
    EthereumMonitor: createServiceToken('EthereumMonitor', 'Ethereum blockchain monitor'),
    CosmosMonitor: createServiceToken('CosmosMonitor', 'Cosmos blockchain monitor'),
    // Services
    RelayService: createServiceToken('RelayService', 'Cross-chain relay service'),
    ChainRegistry: createServiceToken('ChainRegistry', 'Chain registry service'),
    // Utilities
    SecretManager: createServiceToken('SecretManager', 'Secret management service'),
    MetricsCollector: createServiceToken('MetricsCollector', 'Metrics collection service'),
};
//# sourceMappingURL=di.js.map