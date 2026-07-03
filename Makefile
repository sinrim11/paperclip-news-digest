.PHONY: help build up down logs clean stop start restart ps lint test docker-build docker-push

# Default target
help:
	@echo "News Digest DevOps Commands"
	@echo "============================"
	@echo ""
	@echo "Development:"
	@echo "  make up              Start all services (docker-compose up -d)"
	@echo "  make down            Stop all services (docker-compose down)"
	@echo "  make restart         Restart all services"
	@echo "  make logs            View logs from all services"
	@echo "  make logs-web        View web server logs"
	@echo "  make ps              Show running containers"
	@echo "  make clean           Remove containers and volumes (data loss!)"
	@echo ""
	@echo "LLM:"
	@echo "  make test-llm        Test LM Studio connectivity"
	@echo ""
	@echo "Pipeline:"
	@echo "  make run-pipeline    Run news collection pipeline once"
	@echo "  make shell-pipeline  Open shell in pipeline container"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build    Build Docker image"
	@echo "  make docker-push     Push image to registry (requires REGISTRY var)"
	@echo ""
	@echo "Testing & Linting:"
	@echo "  make lint            Lint Python code (flake8, black, isort)"
	@echo "  make format          Format code with black and isort"
	@echo "  make test            Run tests (if tests exist)"
	@echo ""
	@echo "Monitoring:"
	@echo "  make stats           Show container resource usage"
	@echo "  make health          Check service health"
	@echo ""
	@echo "Configuration:"
	@echo "  make env             Create .env file from .env.example"
	@echo ""

# Development targets
up:
	docker-compose up -d
	@echo "✓ Services started"
	@echo "  Web: http://localhost:3200"
	@echo "  LM Studio: http://localhost:1234"

down:
	docker-compose down
	@echo "✓ Services stopped"

stop:
	docker-compose stop

start:
	docker-compose start

restart: down up

logs:
	docker-compose logs -f

logs-web:
	docker-compose logs -f web

ps:
	docker-compose ps

stats:
	docker stats

# Cleanup (dangerous!)
clean:
	@echo "⚠️  This will remove containers and volumes (data loss!)"
	@read -p "Type 'yes' to confirm: " confirm; \
	if [ "$$confirm" = "yes" ]; then \
		docker-compose down -v; \
		echo "✓ Cleaned up"; \
	else \
		echo "Cancelled"; \
	fi

# LLM connectivity (LM Studio는 토큰 인증 필요 — .env의 LLM_API_KEY 사용)
test-llm:
	@echo "Testing LM Studio connectivity..."
	@sh -c 'set -a; [ -f .env ] && . ./.env; set +a; curl -s -H "Authorization: Bearer $$LLM_API_KEY" http://localhost:1234/v1/models | jq .' || echo "LM Studio not available"

# Pipeline management
run-pipeline:
	docker exec news-digest-pipeline python main.py

shell-pipeline:
	docker exec -it news-digest-pipeline /bin/bash

shell-web:
	docker exec -it news-digest-web /bin/bash

# Docker image operations
docker-build:
	docker build -t news-digest:latest .
	@echo "✓ Image built: news-digest:latest"

docker-push:
	@if [ -z "$(REGISTRY)" ]; then \
		echo "Error: REGISTRY not set"; \
		echo "Usage: make docker-push REGISTRY=your-registry"; \
		exit 1; \
	fi
	docker tag news-digest:latest $(REGISTRY)/news-digest:latest
	docker tag news-digest:latest $(REGISTRY)/news-digest:$$(date +%Y%m%d)
	docker push $(REGISTRY)/news-digest:latest
	docker push $(REGISTRY)/news-digest:$$(date +%Y%m%d)
	@echo "✓ Pushed to $(REGISTRY)"

# Code quality
lint:
	@echo "Checking code with flake8..."
	flake8 web_app/ --count --select=E9,F63,F7,F82 --show-source --statistics
	@echo "Checking formatting with black..."
	black --check web_app/ *.py 2>/dev/null || echo "  (formatting issues found - run 'make format')"
	@echo "✓ Linting complete"

format:
	@echo "Formatting code with black..."
	black web_app/ *.py
	@echo "Sorting imports with isort..."
	isort web_app/ *.py
	@echo "✓ Code formatted"

test:
	@echo "Running tests..."
	@if [ -d "tests/" ]; then \
		pytest tests/ -v; \
	else \
		echo "No tests directory found"; \
	fi

# Health checks
health:
	@echo "Checking service health..."
	@echo -n "Web server: "
	@curl -s http://localhost:3200/health | jq .status 2>/dev/null || echo "OFFLINE"
	@echo -n "LM Studio: "
	@curl -s http://localhost:1234/v1/models | jq '.data | length' 2>/dev/null && echo "models loaded" || echo "OFFLINE"

# Configuration
env:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✓ Created .env from .env.example"; \
		echo "  Edit .env with your configuration"; \
	else \
		echo ".env already exists"; \
	fi

# Show targets (useful for IDE integration)
list:
	@grep "^[a-z-]*:" Makefile | cut -d: -f1 | column

# Development workflow
dev-setup: env up
	@echo "✓ Development environment ready"
	@echo "  Run: make logs"
	@echo "  Run: make run-pipeline (to collect news)"

dev-down: down
	@echo "✓ Development environment stopped"
