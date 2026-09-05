.PHONY: up down restart test logs

## Start the stack
up:
	docker compose up -d

## Stop the stack
down:
	docker compose down

## Restart the app (applies migrations via entrypoint)
restart:
	docker compose restart app

## Run API regression tests (stack must be running)
test:
	@./tests/api_test.sh

## View app logs
logs:
	docker compose logs -f app
