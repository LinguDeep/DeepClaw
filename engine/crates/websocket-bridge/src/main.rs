//! WebSocket Bridge Binary for DeepClaw
//!
//! This binary starts the WebSocket server that bridges the Rust engine
//! with the TypeScript agent brain.

use websocket_bridge::{BridgeConfig, WebSocketBridge};
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Read configuration from environment variables
    let host = std::env::var("ENGINE_BRIDGE_HOST")
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("ENGINE_BRIDGE_PORT")
        .unwrap_or_else(|_| "9000".to_string())
        .parse::<u16>()
        .unwrap_or(9000);

    let config = BridgeConfig { host: host.clone(), port };
    let bridge = WebSocketBridge::new(config);

    println!("Starting DeepClaw Engine Bridge on {}:{}", host, port);
    println!("WebSocket endpoint: ws://{}:{}", host, port);

    bridge.run().await
}
