//! WebSocket Bridge for DeepClaw
//!
//! This module provides a WebSocket server that exposes Rust engine capabilities
//! to the TypeScript agent brain, enabling seamless integration between the
//! high-performance Rust engine and the flexible TypeScript agent framework.

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::protocol::Message;
use tracing::{error, info};

/// Bridge configuration
#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub host: String,
    pub port: u16,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 9000,
        }
    }
}

/// Request message from TypeScript agent
#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum BridgeRequest {
    /// Execute a bash command
    BashCommand {
        command: String,
        cwd: Option<String>,
    },
    /// Read a file
    ReadFile { path: String },
    /// Write to a file
    WriteFile { path: String, content: String },
    /// Edit a file
    EditFile {
        path: String,
        old_string: String,
        new_string: String,
    },
    /// Grep search
    GrepSearch {
        pattern: String,
        path: String,
        case_sensitive: Option<bool>,
    },
    /// Glob search
    GlobSearch { pattern: String, path: String },
    /// Get git context
    GitContext { path: String },
}

/// Response message to TypeScript agent
#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum BridgeResponse {
    /// Bash command result
    BashResult {
        exit_code: i32,
        stdout: String,
        stderr: String,
    },
    /// File content
    FileContent { content: String },
    /// Write success
    WriteSuccess,
    /// Edit success
    EditSuccess,
    /// Grep results
    GrepResults { matches: Vec<String> },
    /// Glob results
    GlobResults { files: Vec<String> },
    /// Git context
    GitContext {
        branch: String,
        commit: String,
        status: String,
    },
    /// Error
    Error { message: String },
}

/// WebSocket bridge server
pub struct WebSocketBridge {
    config: BridgeConfig,
}

impl WebSocketBridge {
    pub fn new(config: BridgeConfig) -> Self {
        Self { config }
    }

    /// Start the WebSocket server
    pub async fn run(&self) -> Result<()> {
        let addr = format!("{}:{}", self.config.host, self.config.port);
        let listener = TcpListener::bind(&addr).await?;
        info!("WebSocket bridge listening on {}", addr);

        while let Ok((stream, addr)) = listener.accept().await {
            info!("New connection attempt from {}", addr);

            match tokio_tungstenite::accept_async(stream).await {
                Ok(ws_stream) => {
                    info!("WebSocket connection established from {}", addr);
                    let (mut write, mut read) = ws_stream.split();

                    tokio::spawn(async move {
                        while let Some(message) = read.next().await {
                            match message {
                                Ok(Message::Text(text)) => {
                                    if let Ok(request) =
                                        serde_json::from_str::<BridgeRequest>(&text)
                                    {
                                        let response = Self::handle_request(request).await;
                                        if let Ok(response_json) = serde_json::to_string(&response)
                                        {
                                            let _ = write.send(Message::Text(response_json)).await;
                                        }
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    info!("WebSocket connection closed by {}", addr);
                                    break;
                                }
                                Err(e) => {
                                    error!("WebSocket error from {}: {}", addr, e);
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });
                }
                Err(e) => {
                    error!(
                        "Failed to upgrade connection from {}: {} (not a WebSocket client)",
                        addr, e
                    );
                    // Continue accepting other connections
                }
            }
        }

        Ok(())
    }

    /// Handle an incoming request
    async fn handle_request(request: BridgeRequest) -> BridgeResponse {
        match request {
            BridgeRequest::BashCommand { command, cwd: _ } => {
                // TODO: Integrate with runtime::execute_bash
                BridgeResponse::BashResult {
                    exit_code: 0,
                    stdout: format!("Executed: {}", command),
                    stderr: String::new(),
                }
            }
            BridgeRequest::ReadFile { path } => {
                // TODO: Integrate with runtime::read_file
                BridgeResponse::FileContent {
                    content: format!("Read from: {}", path),
                }
            }
            BridgeRequest::WriteFile {
                path: _,
                content: _,
            } => {
                // TODO: Integrate with runtime::write_file
                BridgeResponse::WriteSuccess
            }
            BridgeRequest::EditFile {
                path: _,
                old_string: _,
                new_string: _,
            } => {
                // TODO: Integrate with runtime::edit_file
                BridgeResponse::EditSuccess
            }
            BridgeRequest::GrepSearch {
                pattern: _,
                path: _,
                case_sensitive: _,
            } => {
                // TODO: Integrate with runtime::grep_search
                BridgeResponse::GrepResults { matches: vec![] }
            }
            BridgeRequest::GlobSearch {
                pattern: _,
                path: _,
            } => {
                // TODO: Integrate with runtime::glob_search
                BridgeResponse::GlobResults { files: vec![] }
            }
            BridgeRequest::GitContext { path: _ } => {
                // TODO: Integrate with runtime::git_context
                BridgeResponse::GitContext {
                    branch: "main".to_string(),
                    commit: "unknown".to_string(),
                    status: "clean".to_string(),
                }
            }
        }
    }
}

/// Start the bridge with default configuration
pub async fn start_bridge() -> Result<()> {
    let bridge = WebSocketBridge::new(BridgeConfig::default());
    bridge.run().await
}
