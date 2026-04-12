.PHONY: all build install clean test run-engine run-brain run-dashboard help

# DeepClaw Unified Build System
# This Makefile orchestrates building and running all DeepClaw components

all: build

# Build all components
build: build-engine build-brain build-dashboard

# Build the Rust engine
build-engine:
	@echo "Building Rust engine..."
	cd engine && cargo build --release

# Build the TypeScript brain
build-brain:
	@echo "Building TypeScript brain..."
	cd brain && pnpm install && pnpm build

# Build the dashboard (install dependencies)
build-dashboard:
	@echo "Building dashboard..."
	cd dashboard && npm install

# Install all dependencies
install: install-engine install-brain install-dashboard

install-engine:
	@echo "Installing Rust engine dependencies..."
	cd engine && cargo build

install-brain:
	@echo "Installing TypeScript brain dependencies..."
	cd brain && pnpm install

install-dashboard:
	@echo "Installing dashboard dependencies..."
	cd dashboard && npm install

# Clean build artifacts
clean: clean-engine clean-brain clean-dashboard

clean-engine:
	@echo "Cleaning Rust engine..."
	cd engine && cargo clean

clean-brain:
	@echo "Cleaning TypeScript brain..."
	cd brain && rm -rf dist

clean-dashboard:
	@echo "Cleaning dashboard..."
	cd dashboard && rm -rf node_modules

# Run tests
test: test-engine test-brain

test-engine:
	@echo "Running Rust engine tests..."
	cd engine && cargo test

test-brain:
	@echo "Running TypeScript brain tests..."
	cd brain && pnpm test

# Run individual components
run-engine:
	@echo "Starting Rust engine bridge..."
	cd engine && cargo run --bin websocket-bridge

run-brain:
	@echo "Starting TypeScript brain..."
	cd brain && pnpm start

run-dashboard:
	@echo "Starting dashboard..."
	cd dashboard && node server.js

# Run all components (development mode)
run-dev:
	@echo "Starting DeepClaw in development mode..."
	@echo "Engine bridge: ws://127.0.0.1:9000"
	@echo "Dashboard: http://localhost:7000"
	@echo "Press Ctrl+C to stop all components"
	@# Start engine bridge in background
	cd engine && cargo run --bin websocket-bridge &
	@# Wait for engine to start
	sleep 5
	@# Start dashboard in background
	cd dashboard && node server.js &
	@# Wait for dashboard to start
	sleep 2
	@echo "All components started. Open http://localhost:7000 in your browser."

# Rename all project references to DeepClaw
rename:
	@echo "Running rename script..."
	chmod +x rename.sh
	./rename.sh

# Development setup
setup:
	@echo "Setting up DeepClaw development environment..."
	@echo "1. Installing Rust toolchain..."
	rustup update
	@echo "2. Installing Node.js and pnpm..."
	npm install -g pnpm
	@echo "3. Building all components..."
	make build
	@echo "4. Setup complete!"

# Help
help:
	@echo "DeepClaw Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  all              - Build all components (default)"
	@echo "  build            - Build all components"
	@echo "  build-engine     - Build Rust engine only"
	@echo "  build-brain      - Build TypeScript brain only"
	@echo "  build-dashboard  - Build dashboard only"
	@echo "  install          - Install all dependencies"
	@echo "  clean            - Clean all build artifacts"
	@echo "  test             - Run all tests"
	@echo "  run-engine       - Run Rust engine bridge"
	@echo "  run-brain        - Run TypeScript brain"
	@echo "  run-dashboard    - Run dashboard"
	@echo "  run-dev          - Run all components in development mode"
	@echo "  rename           - Rename all project references to DeepClaw"
	@echo "  setup            - Initial development setup"
	@echo "  help             - Show this help message"
