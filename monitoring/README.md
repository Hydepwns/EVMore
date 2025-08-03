# 1inch Fusion+ Connection Pool Monitoring

This directory contains monitoring and alerting configuration for the connection pool system.

## Overview

The monitoring stack includes:
- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization and dashboards
- **Alertmanager**: Alert routing and notifications
- **Node Exporter**: System-level metrics

## Quick Start

1. Start the monitoring stack:
```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

2. Access the services:
- Grafana: http://localhost:3001 (admin/fusion123)
- Prometheus: http://localhost:9091
- Alertmanager: http://localhost:9093

3. The connection pool dashboard will be automatically provisioned in Grafana.

## Metrics

### Connection Pool Metrics

The connection pool exposes the following key metrics:

#### Pool Status
- `fusion_connection_pool_connections_total`: Total connections in pool
- `fusion_connection_pool_connections_active`: Active connections
- `fusion_connection_pool_connections_idle`: Idle connections

#### Request Metrics
- `fusion_connection_pool_requests_total`: Total requests served
- `fusion_connection_pool_request_duration_ms`: Request latency histogram
- `fusion_connection_pool_queue_size`: Current queue size
- `fusion_connection_pool_queue_timeouts_total`: Queue timeout counter

#### Health Metrics
- `fusion_connection_pool_health_status`: Endpoint health (0=healthy, 1=unhealthy)
- `fusion_connection_pool_circuit_breaker_status`: Circuit breaker state (0=closed, 1=open)
- `fusion_connection_pool_endpoint_weight`: Endpoint weight for load balancing

#### Error Metrics
- `fusion_connection_pool_errors_total`: Error counter by type
- `fusion_connection_pool_health_check_failures_total`: Health check failure counter

#### Lifecycle Metrics
- `fusion_connection_pool_connections_created_total`: Connections created
- `fusion_connection_pool_connections_destroyed_total`: Connections destroyed

## Dashboards

### Connection Pool Dashboard

The main dashboard (`connection-pool.json`) includes:

1. **Pool Status Overview**
   - Total, active, and idle connections per pool
   - Pool utilization gauges

2. **Performance Metrics**
   - Request rate by pool and endpoint
   - Latency percentiles (p50, p95, p99)

3. **Error Tracking**
   - Error rate by type
   - Circuit breaker status

4. **Health Monitoring**
   - Endpoint health status
   - Weight distribution for load balancing

5. **Queue Metrics**
   - Queue size over time
   - Queue timeout rate

## Alerts

The following alerts are configured:

### Critical Alerts
- `ConnectionPoolExhausted`: No available connections
- `CircuitBreakerOpen`: Circuit breaker activated
- `NoHealthyEndpoints`: All endpoints unhealthy
- `ConnectionPoolQueueTimeouts`: Requests timing out in queue

### Warning Alerts
- `ConnectionPoolHighUtilization`: >80% pool utilization
- `EndpointUnhealthy`: Endpoint unhealthy for 5+ minutes
- `ConnectionPoolHighErrorRate`: Elevated error rate
- `ConnectionPoolHighLatency`: p95 latency >1s
- `ConnectionPoolQueueGrowing`: Queue size >10
- `ConnectionPoolHighChurn`: High connection turnover

## Configuration

### Adding Notification Channels

Edit `alertmanager/config.yml` to add your notification integrations:

```yaml
receivers:
  - name: 'critical'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK'
        channel: '#critical-alerts'
```

### Customizing Alerts

Alerts are defined in `prometheus/alerts/connection-pool.yml`. Adjust thresholds based on your requirements:

```yaml
- alert: ConnectionPoolHighUtilization
  expr: (fusion_connection_pool_connections_active / fusion_connection_pool_connections_total) > 0.8
  for: 5m  # Adjust duration
```

### Dashboard Customization

Dashboards can be modified in Grafana UI. Changes are saved to the provisioned JSON files.

## Troubleshooting

### No Metrics Appearing

1. Check relayer is exposing metrics:
```bash
curl http://localhost:9090/metrics | grep fusion_connection_pool
```

2. Verify Prometheus targets:
- Go to Prometheus UI: http://localhost:9091/targets
- Check "fusion-relayer" and "connection-pools" are UP

### Dashboard Not Loading

1. Check Grafana logs:
```bash
docker-compose -f docker-compose.monitoring.yml logs grafana
```

2. Verify dashboard provisioning:
```bash
docker exec fusion-grafana ls -la /var/lib/grafana/dashboards/
```

### Alerts Not Firing

1. Check Prometheus rules:
- Go to http://localhost:9091/rules
- Verify rules are loaded and evaluating

2. Check Alertmanager:
- Go to http://localhost:9093
- Check for silenced or inhibited alerts

## Production Deployment

For production:

1. **Persistence**: Ensure volumes are backed up
2. **High Availability**: Run multiple Prometheus instances
3. **Security**: Enable authentication and TLS
4. **Retention**: Configure appropriate data retention
5. **Resources**: Adjust container resources based on load

Example production configuration additions:

```yaml
services:
  prometheus:
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'
    command:
      - '--storage.tsdb.retention.time=30d'
      - '--storage.tsdb.retention.size=50GB'
```

## Integration with Existing Monitoring

To integrate with existing Prometheus:

1. Add scrape job to your Prometheus configuration:
```yaml
- job_name: 'fusion-connection-pools'
  static_configs:
    - targets: ['relayer:9090']
  metric_relabel_configs:
    - source_labels: [__name__]
      regex: 'fusion_connection_pool_.*'
      action: keep
```

2. Import dashboard JSON into your Grafana instance

3. Add alert rules to your Prometheus rule files