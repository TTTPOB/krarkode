// Minimal JSON-RPC 2.0 transport over TCP with Content-Length framing.
//
// Implements the base protocol used by LSP: each message is preceded by
// `Content-Length: <N>\r\n\r\n` followed by N bytes of JSON.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tracing::{debug, trace, warn};

/// JSON-RPC 2.0 request (has id, expects response).
#[derive(Serialize)]
struct JsonRpcRequest<'a, P: Serialize> {
    jsonrpc: &'static str,
    id: i64,
    method: &'a str,
    params: P,
}

/// JSON-RPC 2.0 notification (no id, no response expected).
#[derive(Serialize)]
struct JsonRpcNotification<'a, P: Serialize> {
    jsonrpc: &'static str,
    method: &'a str,
    params: P,
}

/// JSON-RPC 2.0 message envelope.
///
/// Used to deserialize:
/// - Responses (`id` + `result`/`error`)
/// - Server requests (`id` + `method`)
/// - Server notifications (`method` only)
#[derive(Deserialize, Debug)]
struct JsonRpcMessage {
    id: Option<Value>,
    method: Option<String>,
    params: Option<Value>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 success response envelope.
#[derive(Serialize)]
struct JsonRpcSuccessResponse {
    jsonrpc: &'static str,
    id: Value,
    result: Value,
}

/// JSON-RPC 2.0 error response envelope.
#[derive(Serialize)]
struct JsonRpcErrorResponse {
    jsonrpc: &'static str,
    id: Value,
    error: JsonRpcResponseError,
}

/// JSON-RPC 2.0 error response object.
#[derive(Serialize)]
struct JsonRpcResponseError {
    code: i64,
    message: String,
}

/// JSON-RPC 2.0 error object.
#[derive(Deserialize, Debug)]
pub(crate) struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[allow(dead_code)]
    pub data: Option<Value>,
}

impl std::fmt::Display for JsonRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "JSON-RPC error {}: {}", self.code, self.message)
    }
}

/// Low-level JSON-RPC transport with Content-Length framing over TCP.
///
/// Designed for single-threaded request-response usage (one request at a time).
/// Reader and writer are behind Mutexes for future-proofing but current usage
/// is strictly sequential.
pub(crate) struct LspTransport {
    reader: Mutex<BufReader<Box<dyn AsyncRead + Unpin + Send>>>,
    writer: Mutex<Box<dyn AsyncWrite + Unpin + Send>>,
    next_id: AtomicI64,
}

impl LspTransport {
    /// Connect to an LSP server at the given address and port.
    pub async fn connect(addr: &str, port: u16) -> Result<Self> {
        debug!(addr = %addr, port = port, "LspTransport: connecting");
        let stream = TcpStream::connect((addr, port))
            .await
            .with_context(|| format!("Failed to connect to LSP at {addr}:{port}"))?;
        debug!("LspTransport: connected");

        let (read_half, write_half) = stream.into_split();
        Ok(Self::from_io(read_half, write_half))
    }

    fn from_io<R, W>(reader: R, writer: W) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        Self {
            reader: Mutex::new(BufReader::new(Box::new(reader))),
            writer: Mutex::new(Box::new(writer)),
            next_id: AtomicI64::new(1),
        }
    }

    /// Send a JSON-RPC request and wait for the response.
    ///
    /// This is a blocking call that holds both reader and writer locks.
    /// Only one request should be in flight at a time.
    ///
    /// Server-initiated notifications (messages without an `id`) are
    /// skipped automatically so they don't shadow the expected response.
    pub async fn request<P: Serialize, R: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: &P,
    ) -> Result<R> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };

        let body = serde_json::to_vec(&request).context("Failed to serialize JSON-RPC request")?;

        debug!(
            method = %method,
            id = id,
            body_len = body.len(),
            "LspTransport: sending request"
        );
        trace!(body = %String::from_utf8_lossy(&body), "LspTransport: request body");

        self.write_message(&body).await?;

        // Read messages until we get a response with a matching id.
        // Server-initiated notifications (no id) and responses to other
        // requests (mismatched id) are logged and skipped.
        loop {
            let response_body = self.read_message().await?;

            trace!(
                body = %String::from_utf8_lossy(&response_body),
                "LspTransport: received message"
            );

            let message: JsonRpcMessage = serde_json::from_slice(&response_body)
                .context("Failed to parse JSON-RPC response")?;

            if let Some(method) = message.method.as_deref() {
                if let Some(request_id) = message.id.clone() {
                    self.handle_server_request(request_id, method, message.params.as_ref())
                        .await
                        .with_context(|| {
                            format!(
                                "Failed to handle server request '{method}' while waiting for response id={id}"
                            )
                        })?;
                } else {
                    debug!(
                        method = %method,
                        "LspTransport: skipping server notification while waiting for response id={id}"
                    );
                }
                continue;
            }

            match &message.id {
                None => {
                    debug!(
                        "LspTransport: skipping id-less message while waiting for response id={id}"
                    );
                    continue;
                }
                Some(resp_id) => {
                    let expected_id = Value::Number(serde_json::Number::from(id));
                    if *resp_id != expected_id {
                        debug!(
                            expected_id = id,
                            actual_id = %resp_id,
                            "LspTransport: skipping response with mismatched id"
                        );
                        continue;
                    }
                }
            }

            if let Some(err) = message.error {
                return Err(anyhow!("{}", err));
            }

            let result_value = message.result.unwrap_or(Value::Null);
            let result: R = serde_json::from_value(result_value)
                .context("Failed to deserialize JSON-RPC result")?;

            debug!(method = %method, id = id, "LspTransport: request completed");
            return Ok(result);
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    pub async fn notify<P: Serialize>(&self, method: &str, params: &P) -> Result<()> {
        let notification = JsonRpcNotification {
            jsonrpc: "2.0",
            method,
            params,
        };

        let body = serde_json::to_vec(&notification)
            .context("Failed to serialize JSON-RPC notification")?;

        debug!(
            method = %method,
            body_len = body.len(),
            "LspTransport: sending notification"
        );
        trace!(body = %String::from_utf8_lossy(&body), "LspTransport: notification body");

        self.write_message(&body).await?;
        Ok(())
    }

    async fn handle_server_request(
        &self,
        id: Value,
        method: &str,
        _params: Option<&Value>,
    ) -> Result<()> {
        match method {
            "client/registerCapability" | "client/unregisterCapability" => {
                debug!(
                    id = %id,
                    method = %method,
                    "LspTransport: acknowledging server capability request"
                );
                self.send_success_response(id, Value::Null).await
            }
            "workspace/configuration" => {
                debug!(
                    id = %id,
                    method = %method,
                    "LspTransport: replying to workspace/configuration with empty settings"
                );
                self.send_success_response(id, Value::Array(vec![])).await
            }
            _ => {
                warn!(
                    id = %id,
                    method = %method,
                    "LspTransport: received unsupported server request"
                );
                self.send_error_response(
                    id,
                    -32601,
                    format!("Unsupported server request method: {method}"),
                )
                .await
            }
        }
    }

    async fn send_success_response(&self, id: Value, result: Value) -> Result<()> {
        let response = JsonRpcSuccessResponse {
            jsonrpc: "2.0",
            id,
            result,
        };
        let body = serde_json::to_vec(&response)
            .context("Failed to serialize JSON-RPC success response")?;
        trace!(
            body = %String::from_utf8_lossy(&body),
            "LspTransport: success response body"
        );
        self.write_message(&body).await
    }

    async fn send_error_response(&self, id: Value, code: i64, message: String) -> Result<()> {
        let response = JsonRpcErrorResponse {
            jsonrpc: "2.0",
            id,
            error: JsonRpcResponseError { code, message },
        };
        let body =
            serde_json::to_vec(&response).context("Failed to serialize JSON-RPC error response")?;
        trace!(
            body = %String::from_utf8_lossy(&body),
            "LspTransport: error response body"
        );
        self.write_message(&body).await
    }

    /// Write a Content-Length framed message.
    async fn write_message(&self, body: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().await;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        writer
            .write_all(header.as_bytes())
            .await
            .context("Failed to write message header")?;
        writer
            .write_all(body)
            .await
            .context("Failed to write message body")?;
        writer.flush().await.context("Failed to flush writer")?;
        Ok(())
    }

    /// Read a Content-Length framed message.
    async fn read_message(&self) -> Result<Vec<u8>> {
        let mut reader = self.reader.lock().await;

        // Read headers until empty line
        let mut content_length: Option<usize> = None;
        loop {
            let mut header_line = String::new();
            let bytes_read = reader
                .read_line(&mut header_line)
                .await
                .context("Failed to read message header")?;
            if bytes_read == 0 {
                return Err(anyhow!("Connection closed while reading header"));
            }

            let trimmed = header_line.trim();
            if trimmed.is_empty() {
                // End of headers
                break;
            }

            if let Some(value) = trimmed.strip_prefix("Content-Length:") {
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .context("Invalid Content-Length value")?,
                );
            }
            // Ignore other headers (e.g., Content-Type)
        }

        let length = content_length.ok_or_else(|| anyhow!("Missing Content-Length header"))?;

        let mut body = vec![0u8; length];
        reader
            .read_exact(&mut body)
            .await
            .context("Failed to read message body")?;

        Ok(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_rpc_request_serialization() {
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "textDocument/completion",
            params: serde_json::json!({"key": "value"}),
        };
        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], 1);
        assert_eq!(json["method"], "textDocument/completion");
        assert_eq!(json["params"]["key"], "value");
    }

    #[test]
    fn json_rpc_notification_serialization() {
        let notification = JsonRpcNotification {
            jsonrpc: "2.0",
            method: "initialized",
            params: serde_json::json!({}),
        };
        let json = serde_json::to_value(&notification).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["method"], "initialized");
        assert!(json.get("id").is_none());
    }

    #[test]
    fn json_rpc_message_response_deserialization() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}"#;
        let response: JsonRpcMessage = serde_json::from_str(json).unwrap();
        assert!(response.method.is_none());
        assert!(response.error.is_none());
        assert!(response.result.is_some());
    }

    #[test]
    fn json_rpc_message_error_deserialization() {
        let json =
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#;
        let response: JsonRpcMessage = serde_json::from_str(json).unwrap();
        assert!(response.error.is_some());
        let err = response.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    #[tokio::test]
    async fn request_handles_server_request_before_response() {
        use tokio::io::{duplex, split, ReadHalf, WriteHalf};

        async fn read_framed_message(
            reader: &mut BufReader<ReadHalf<tokio::io::DuplexStream>>,
        ) -> Vec<u8> {
            let mut content_length: Option<usize> = None;
            loop {
                let mut header_line = String::new();
                let bytes_read = reader.read_line(&mut header_line).await.unwrap();
                assert!(bytes_read > 0);

                let trimmed = header_line.trim();
                if trimmed.is_empty() {
                    break;
                }

                if let Some(value) = trimmed.strip_prefix("Content-Length:") {
                    content_length = Some(value.trim().parse::<usize>().unwrap());
                }
            }

            let length = content_length.expect("missing content length");
            let mut body = vec![0; length];
            reader.read_exact(&mut body).await.unwrap();
            body
        }

        async fn write_framed_message(
            writer: &mut WriteHalf<tokio::io::DuplexStream>,
            body: &[u8],
        ) {
            let header = format!("Content-Length: {}\r\n\r\n", body.len());
            writer.write_all(header.as_bytes()).await.unwrap();
            writer.write_all(body).await.unwrap();
            writer.flush().await.unwrap();
        }

        let (client_stream, server_stream) = duplex(8192);
        let (client_read, client_write) = split(client_stream);

        let server = tokio::spawn(async move {
            let (read_half, mut write_half) = split(server_stream);
            let mut reader = BufReader::new(read_half);

            let request_body = read_framed_message(&mut reader).await;
            let request: Value = serde_json::from_slice(&request_body).unwrap();
            assert_eq!(request["id"], 1);
            assert_eq!(request["method"], "textDocument/completion");

            let register_request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 0,
                "method": "client/registerCapability",
                "params": { "registrations": [] }
            });
            write_framed_message(
                &mut write_half,
                serde_json::to_vec(&register_request).unwrap().as_slice(),
            )
            .await;

            let register_response_body = read_framed_message(&mut reader).await;
            let register_response: Value = serde_json::from_slice(&register_response_body).unwrap();
            assert_eq!(register_response["id"], 0);
            assert_eq!(register_response["result"], Value::Null);

            let completion_response = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": []
            });
            write_framed_message(
                &mut write_half,
                serde_json::to_vec(&completion_response).unwrap().as_slice(),
            )
            .await;
        });

        let transport = LspTransport::from_io(client_read, client_write);
        let response: Vec<Value> = transport
            .request("textDocument/completion", &serde_json::json!({}))
            .await
            .unwrap();

        assert!(response.is_empty());
        server.await.unwrap();
    }
}
