# Operations Guide

## Production Deployment

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Access to RPC endpoints
- Environment secrets configured

### Deployment Steps
```bash
# 1. Build production bundles
npm run build

# 2. Deploy using Docker
docker-compose -f docker-compose.yml up -d

# 3. Verify services
docker-compose ps
docker-compose logs relayer
```

### Environment Configuration
```yaml
# docker-compose.yml
version: '3.8'
services:
  relayer:
    image: evmore/relayer:latest
    environment:
      - FUSION_ENV=production
      - ETHEREUM_RPC_URL=${ETHEREUM_RPC_URL}
      - COSMOS_RPC_URL=${COSMOS_RPC_URL}
      - LOG_LEVEL=info
    volumes:
      - ./config:/app/config:ro
    ports:
      - "3000:3000"
    restart: unless-stopped
    
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
```

### Health Checks
```bash
# Service health
curl http://localhost:3000/health

# Metrics endpoint
curl http://localhost:3000/metrics

# Pool status
curl http://localhost:3000/admin/pools/status
```

## Monitoring & Observability

### Prometheus Metrics
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'evmore-relayer'
    static_configs:
      - targets: ['relayer:3000']
    metrics_path: /metrics
    scrape_interval: 10s
```

### Key Metrics to Monitor
```typescript
// Connection Pool Metrics
evmore_pool_connections_total{pool="ethereum"}
evmore_pool_connections_active{pool="ethereum"}
evmore_pool_connections_idle{pool="ethereum"}
evmore_pool_acquire_duration_seconds

// Relay Performance
evmore_relay_swaps_total{status="completed"}
evmore_relay_swaps_total{status="failed"}
evmore_relay_duration_seconds
evmore_relay_queue_size

// System Health
evmore_health_status{service="monitor"}
evmore_health_status{service="relayer"}
process_cpu_seconds_total
nodejs_heap_size_used_bytes
```

### Grafana Dashboards
```json
{
  "dashboard": {
    "title": "EVMore Operations",
    "panels": [
      {
        "title": "Swap Success Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(evmore_relay_swaps_total{status=\"completed\"}[5m]) / rate(evmore_relay_swaps_total[5m]) * 100"
          }
        ]
      },
      {
        "title": "Connection Pool Utilization", 
        "type": "graph",
        "targets": [
          {
            "expr": "evmore_pool_connections_active / evmore_pool_connections_total * 100"
          }
        ]
      }
    ]
  }
}
```

### OpenTelemetry Tracing
```typescript
import { trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'evmore-relayer',
  traceExporter: new JaegerExporter({
    endpoint: 'http://jaeger:14268/api/traces'
  })
});

sdk.start();
```

## Administrative Controls

### Admin API Endpoints
```typescript
// Pool management
GET    /admin/pools/status           # Pool statistics
POST   /admin/pools/drain           # Graceful shutdown
POST   /admin/pools/refresh         # Refresh connections

// Service control
POST   /admin/services/pause        # Pause processing
POST   /admin/services/resume       # Resume processing
GET    /admin/services/status       # Service status

// Configuration
GET    /admin/config               # Current configuration
POST   /admin/config/reload        # Reload configuration
```

### Emergency Procedures
```bash
# 1. Pause all processing
curl -X POST http://localhost:3000/admin/services/pause

# 2. Drain connection pools
curl -X POST http://localhost:3000/admin/pools/drain

# 3. Check pending operations
curl http://localhost:3000/admin/swaps/pending

# 4. Emergency shutdown
docker-compose stop relayer
```

### Backup & Recovery
```bash
# Database backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Redis backup  
redis-cli --rdb dump-$(date +%Y%m%d).rdb

# Configuration backup
cp -r config/ backup/config-$(date +%Y%m%d)/
```

## Secrets Management

### 1Password Integration
```typescript
import { OnePasswordSecretsProvider } from '../relayer/src/secrets/onepassword-secrets-provider';

const secretsProvider = new OnePasswordSecretsProvider({
  serviceAccountToken: process.env.OP_SERVICE_ACCOUNT_TOKEN,
  vault: 'evmore-production'
});

const privateKey = await secretsProvider.getSecret('ethereum-private-key');
```

### AWS Secrets Manager
```typescript
import { AWSSecretsProvider } from '../relayer/src/secrets/aws-secrets-provider';

const secretsProvider = new AWSSecretsProvider({
  region: 'us-east-1',
  secretPrefix: 'evmore/'
});

const config = await secretsProvider.getSecrets([
  'ethereum-private-key',
  'cosmos-mnemonic',
  'database-password'
]);
```

### HashiCorp Vault
```typescript
import { VaultSecretsProvider } from '../relayer/src/secrets/vault-secrets-provider';

const secretsProvider = new VaultSecretsProvider({
  endpoint: 'https://vault.company.com',
  token: process.env.VAULT_TOKEN,
  mountPath: 'secret/evmore'
});
```

## Performance Tuning

### Connection Pool Optimization
```typescript
// Production connection pool settings
const productionConfig = {
  ethereum: {
    maxConnections: 50,           // Based on Infura/Alchemy limits
    minConnections: 10,           // Always ready connections
    acquireTimeout: 30000,        // 30s max wait
    healthCheckInterval: 60000,   // Check every minute
    retryDelay: 1000             // 1s between retries
  },
  cosmos: {
    maxConnections: 20,
    minConnections: 5,
    acquireTimeout: 15000,
    healthCheckInterval: 60000
  }
};
```

### Memory Management
```typescript
// Enable heap monitoring
const heapMonitor = setInterval(() => {
  const usage = process.memoryUsage();
  if (usage.heapUsed > 500 * 1024 * 1024) { // 500MB
    logger.warn('High memory usage detected', usage);
  }
}, 30000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  clearInterval(heapMonitor);
  await container.dispose();
  process.exit(0);
});
```

### Database Optimization
```sql
-- Index for performance
CREATE INDEX idx_swaps_status ON swaps(status);
CREATE INDEX idx_swaps_created_at ON swaps(created_at);
CREATE INDEX idx_swaps_chain ON swaps(from_chain, to_chain);

-- Cleanup old records
DELETE FROM swaps WHERE created_at < NOW() - INTERVAL '30 days';
```

## Security Hardening

### Network Security
```yaml
# firewall rules
- allow port 3000 from load balancer only
- allow port 9090 from monitoring network only  
- block all other incoming traffic
- allow outbound to RPC endpoints only
```

### Container Security
```dockerfile
# Use non-root user
USER node

# Read-only filesystem
RUN chmod -R 555 /app
VOLUME ["/tmp"]

# Security scanning
RUN npm audit --audit-level moderate
```

### Secrets Security
- Never log secrets or private keys
- Use environment variables or secret managers
- Rotate secrets regularly
- Enable secret scanning in CI/CD

## Troubleshooting

### Common Issues
1. **High Memory Usage**: Check for connection leaks, enable heap profiling
2. **RPC Rate Limits**: Tune connection pool size and request rates
3. **Database Locks**: Monitor long-running queries and connection counts
4. **IBC Timeouts**: Check chain connectivity and packet acknowledgments

### Debug Mode
```bash
# Enable debug logging
export LOG_LEVEL=debug
export ENABLE_TRACING=true

# Restart services
docker-compose restart relayer
```

### Log Analysis
```bash
# Error rate
docker logs relayer 2>&1 | grep ERROR | wc -l

# Performance tracking
docker logs relayer 2>&1 | grep "swap_duration" | tail -100

# Memory patterns
docker stats relayer --no-stream
```

### Emergency Contacts
- **On-call Engineer**: [Slack channel or phone]
- **Infrastructure Team**: [Contact details]
- **Security Team**: [Contact for incidents]