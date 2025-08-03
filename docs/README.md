# EVMore Documentation

## Quick Start

Choose your path based on your role:

| Role | Start Here | Then Read |
|------|-----------|-----------|
| **Developer** | [Development Guide](DEVELOPMENT_GUIDE.md) | Protocol Design |
| **DevOps/SRE** | [Operations Guide](OPERATIONS_GUIDE.md) | Development Guide |
| **Architect** | [Protocol Design](PROTOCOL_DESIGN.md) | Operations Guide |
| **Product Manager** | [Protocol Design](PROTOCOL_DESIGN.md) | Development Guide |

## Core Documentation

### 📖 [Development Guide](DEVELOPMENT_GUIDE.md)

**For: Engineers, Integration Teams**

- Configuration & environment setup
- Connection pool implementation
- Service container & dependency injection
- Testing infrastructure & performance optimization
- Migration from legacy code & troubleshooting

### 🚀 [Operations Guide](OPERATIONS_GUIDE.md)

**For: DevOps, SRE, Production Teams**

- Production deployment procedures
- Monitoring & observability (Prometheus, Grafana, OpenTelemetry)
- Administrative controls & emergency procedures
- Secrets management (1Password, AWS, Vault)
- Performance tuning & security hardening

### 🏗️ [Protocol Design](PROTOCOL_DESIGN.md)

**For: Architects, Protocol Engineers**

- Cross-chain architecture & multi-hop IBC routing
- Packet handling & acknowledgment processing
- DEX integration (Osmosis, AMM protocols)
- Chain registry integration & route optimization
- Security & MEV protection mechanisms

## Key Features

### 🎯 Production Ready

- **Comprehensive test coverage** with integration testing
- **Optimized bundles** for web deployment
- **Enterprise-grade libraries** with full TypeScript support
- **Turborepo monorepo** with optimized builds

### 🔧 Developer Experience

- **Dependency Injection** for service-oriented architecture
- **Connection Pooling** with automatic retry and health monitoring
- **Backward Compatibility** via migration adapters
- **Type Safety** with TypeScript project references

### 📊 Operations Excellence

- **Prometheus Metrics** for performance monitoring
- **OpenTelemetry Tracing** for distributed observability
- **Secret Management** with enterprise provider support
- **Health Checks** and administrative controls

### 🌐 Protocol Innovation

- **Multi-hop IBC Routing** for optimal cross-chain paths
- **MEV Protection** with commit-reveal schemes
- **Dynamic Route Discovery** via Chain Registry integration
- **DEX Integration** for seamless liquidity access

## Architecture Overview

```
┌─ @evmore/* Libraries ─┐    ┌─ Core Components ─┐    ┌─ External Systems ─┐
│  types, interfaces    │◄──►│  SDK              │◄──►│  Ethereum         │
│  errors, config       │    │  Relayer          │    │  Cosmos Chains    │
│  utils, test-utils    │    │  Contracts        │    │  DEX Protocols    │
│  connection-pool      │    │  Test Suites      │    │  Chain Registry   │
└───────────────────────┘    └───────────────────┘    └───────────────────┘
```

## Getting Started

### Local Development

```bash
git clone <repository>
cd EVMore
npm install
npm run build
npm run dev:relayer
```

### Production Deployment

```bash
docker-compose -f docker-compose.yml up -d
curl http://localhost:3000/health
```

### Integration

```typescript
import { EvmoreClient } from '@evmore/sdk';

const client = new EvmoreClient(config);
const quote = await client.getSwapQuote(swapParams);
```

---

*EVMore: Enterprise-grade cross-chain protocol with modular architecture, comprehensive testing, and production-ready operations.*
