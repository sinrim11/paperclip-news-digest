# News Digest Deployment Guide

## Quick Start with Docker

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- 20+ GB free disk space (for Ollama models)
- 8+ GB RAM recommended

### Local Development

1. **Setup environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Start services**
   ```bash
   docker-compose up -d
   ```

3. **Pull Ollama model** (one-time, takes 10+ minutes)
   ```bash
   docker exec news-digest-ollama ollama pull gemma4:26b
   ```

4. **Access the application**
   - Web UI: http://localhost:3200
   - Health check: http://localhost:3200/health
   - Ollama API: http://localhost:11434

### Running the News Pipeline

Option 1: Run manually
```bash
docker exec news-digest-pipeline python main.py
```

Option 2: Schedule with cron (on host machine)
```bash
# Add to crontab (runs daily at 6 AM)
0 6 * * * cd /path/to/news-digest && docker exec news-digest-pipeline python main.py
```

Option 3: Enable automatic startup (edit docker-compose.yml)
```yaml
pipeline:
  command: python main.py  # Replace 'sleep infinity'
```

## Production Deployment

### Container Registry

1. **Build and push image**
   ```bash
   docker build -t your-registry/news-digest:latest .
   docker push your-registry/news-digest:latest
   ```

2. **For multi-arch (ARM64 for Apple Silicon, etc.)**
   ```bash
   docker buildx build --platform linux/amd64,linux/arm64 \
     -t your-registry/news-digest:latest \
     --push .
   ```

### Environment-Specific Configuration

Create environment files:
- `.env.production` - Production secrets
- `.env.staging` - Staging configuration
- `.env.development` - Local development

Load with:
```bash
docker-compose --env-file .env.production up -d
```

### Volume Management

Persistent volumes for production:
```yaml
volumes:
  news_digest_output:
    driver: local
  ollama_cache:
    driver: local
```

### Health Monitoring

The application exposes health check endpoints:

- **Web server health**: `GET /health` → `{"status": "ok"}`
- **Ollama health**: `GET http://ollama:11434/api/tags`

### Scaling Considerations

**Web Server**: Stateless, can scale horizontally with load balancer
```bash
# Run multiple web instances
docker-compose up -d --scale web=3
```

**Ollama**: Single instance, GPU-accelerated. Cannot scale horizontally.
- Option 1: Use larger GPU instance
- Option 2: Use MLX on CPU (slower but works)

**Pipeline**: Run on separate schedule/server
- Use Kubernetes CronJob
- AWS EventBridge + Lambda
- GitHub Actions scheduled workflow

## Docker Compose Services

### ollama
- **Port**: 11434
- **Volume**: `ollama_data` (10+ GB)
- **Health**: Checks `/api/tags` endpoint
- **Model**: Requires manual pull or auto-pull (slow)

### web
- **Port**: 3200
- **Volumes**: `output/`, `config/`, `web_app/`
- **Command**: `uvicorn web_app.main:app --reload`
- **Depends on**: ollama

### pipeline
- **Default**: Sleeps (manual execution)
- **Option**: Run `python main.py` on startup
- **Cron**: Better for scheduled execution
- **Volumes**: `output/`, `config/`, `news_strategy/`

## Troubleshooting

### Ollama won't start or is slow
- Check disk space: `df -h`
- Check RAM: `free -h`
- Monitor: `docker logs news-digest-ollama`

### Web server connection errors
- Verify Ollama is healthy: `docker exec news-digest-ollama ollama list`
- Check network: `docker network ls`
- Verify endpoints in `.env` match service names

### Output directory missing
- Create manually: `mkdir -p output`
- Ensure Docker has write permissions
- Check volume mounts in docker-compose

### High memory usage
- Reduce MODEL size: use `gemma2:2b` instead of `gemma4:26b`
- Run pipeline less frequently
- Use MLX on CPU (if available)

## Performance Tuning

### CPU
```bash
# Limit CPU usage
docker-compose.yml:
  services:
    ollama:
      cpus: '4'
      cpu_shares: 1024
```

### Memory
```yaml
    ollama:
      mem_limit: 16g
      memswap_limit: 20g
```

### GPU Acceleration (if available)
```yaml
    ollama:
      deploy:
        resources:
          reservations:
            devices:
              - driver: nvidia
                count: 1
                capabilities: [gpu]
```

## Monitoring & Logging

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f web
docker-compose logs -f ollama

# Recent logs only
docker-compose logs --tail=100 ollama
```

### Performance metrics
```bash
docker stats news-digest-web
docker stats news-digest-ollama
```

### Application metrics
- Total articles processed: Check `output/raw_YYYYMMDD.json`
- Summary quality: Check timestamps in web UI
- API response time: Monitor `/health` endpoint

## Cleanup

```bash
# Stop all services
docker-compose down

# Remove volumes (data loss!)
docker-compose down -v

# Remove images
docker image rm news-digest-web ollama/ollama

# Full cleanup
docker system prune -a --volumes
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/setup-buildx-action@v2
      - uses: docker/build-push-action@v4
        with:
          push: true
          tags: ${{ secrets.REGISTRY }}/news-digest:${{ github.sha }}
```

### Kubernetes Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: news-digest-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: news-digest-web
  template:
    metadata:
      labels:
        app: news-digest-web
    spec:
      containers:
      - name: web
        image: your-registry/news-digest:latest
        ports:
        - containerPort: 3200
        env:
        - name: OLLAMA_API_URL
          value: http://ollama-service:11434/v1/chat/completions
        livenessProbe:
          httpGet:
            path: /health
            port: 3200
          initialDelaySeconds: 30
          periodSeconds: 10
```

## Maintenance

### Regular tasks
- Monitor disk usage (Ollama cache grows)
- Archive old `output/` JSON files
- Update base images monthly
- Test failover/recovery procedures

### Upgrade path
1. Pull latest code: `git pull`
2. Rebuild image: `docker-compose build --no-cache`
3. Rolling update: `docker-compose up -d` (replaces service)
4. Verify: Check `/health` endpoint

## Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Verify configuration: Compare `.env` with `.env.example`
3. Test Ollama directly: `curl http://localhost:11434/api/tags`
4. Restart services: `docker-compose restart`
