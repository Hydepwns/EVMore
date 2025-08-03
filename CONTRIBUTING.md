# Contributing to EVMore

Thank you for your interest in contributing to EVMore! This cross-chain protocol bridges Ethereum and Cosmos ecosystems with enterprise-grade architecture.

## Getting Started

### Development Setup
```bash
git clone <repository>
cd EVMore
npm install
npm run build
npm run test
```

### Architecture Overview
EVMore uses a monorepo structure with 7 enterprise libraries:
- `@evmore/types` - Core type definitions
- `@evmore/interfaces` - Service contracts
- `@evmore/errors` - Structured error handling
- `@evmore/config` - Configuration management
- `@evmore/utils` - Infrastructure utilities
- `@evmore/connection-pool` - Connection management
- `@evmore/test-utils` - Testing framework

## Development Guidelines

### Code Standards
- **TypeScript Strict Mode**: All code must pass strict type checking
- **Test Coverage**: Maintain >95% test coverage for new features
- **Error Handling**: Use structured errors from `@evmore/errors`
- **Documentation**: Update relevant guides for user-facing changes

### Testing Requirements
```bash
# Run tests before submitting
npm test                    # All tests must pass
npm run test:architecture   # Validate library integration
npm run build              # Ensure clean builds
```

### Pull Request Process
1. **Create Feature Branch**: `git checkout -b feature/your-feature-name`
2. **Implement Changes**: Follow existing patterns and conventions
3. **Add Tests**: Ensure comprehensive test coverage
4. **Update Documentation**: Modify relevant guides if needed
5. **Submit PR**: Include clear description and test results

### Code Review Checklist
- [ ] All tests pass (minimum 95% pass rate)
- [ ] TypeScript compiles without errors
- [ ] No new security vulnerabilities introduced
- [ ] Documentation updated for user-facing changes
- [ ] Performance impact considered for high-frequency code paths

## Contribution Areas

### High Priority
- **Performance Optimization**: Caching, batch processing, gas optimization
- **Chain Integration**: Adding support for new Cosmos chains
- **Security Enhancements**: Advanced validation, MEV protection
- **Operations**: Monitoring, alerting, deployment automation

### Medium Priority
- **Developer Experience**: Better tooling, debugging capabilities
- **Protocol Features**: Multi-asset swaps, liquidity aggregation
- **Documentation**: Tutorials, examples, API documentation

## Architecture Principles

### Design Philosophy
- **Modular Architecture**: Clear separation of concerns
- **Enterprise Grade**: Production-ready with comprehensive testing
- **Backward Compatibility**: Maintain migration adapters during transitions
- **Performance First**: Optimize for throughput and low latency

### Library Dependencies
```typescript
// Always use enterprise libraries
import { SwapOrder } from '@evmore/types';
import { ServiceContainer } from '@evmore/interfaces';
import { ConfigurationError } from '@evmore/errors';
import { loadConfig } from '@evmore/config';
```

## Security Guidelines

### Security Requirements
- **Input Validation**: Validate all external inputs using `@evmore/types` validators
- **Secret Management**: Never commit secrets; use environment variables or secret providers
- **Rate Limiting**: Implement appropriate rate limits for public endpoints
- **Error Handling**: Don't expose internal details in error messages

### Security Review Process
All security-related changes require:
1. Security impact assessment
2. Code review by security-aware team member
3. Additional testing for edge cases and attack vectors
4. Documentation of security considerations

## Getting Help

### Resources
- **[Development Guide](docs/DEVELOPMENT_GUIDE.md)** - Technical implementation details
- **[Operations Guide](docs/OPERATIONS_GUIDE.md)** - Deployment and monitoring
- **[Protocol Design](docs/PROTOCOL_DESIGN.md)** - Architecture and design decisions

### Communication
- **Issues**: Use GitHub issues for bugs and feature requests
- **Discussions**: Use GitHub discussions for questions and ideas
- **Security**: Report security issues privately via email

## Recognition

Contributors who make significant improvements to EVMore will be recognized in:
- Project README acknowledgments
- Release notes for major contributions  
- Technical blog posts highlighting innovations

---

*By contributing to EVMore, you're helping build the future of cross-chain infrastructure with enterprise-grade reliability and performance.*