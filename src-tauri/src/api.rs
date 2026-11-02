//! Calls to the OpenVizPilot middleware with the signed-in session. The ID
//! token travels exactly like the extension's: as `Authorization: Bearer`.

use futures_util::StreamExt;
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde_json::{json, Map, Value};
use tauri::ipc::Channel;

/// Error text the UI recognises as "signed out".
pub const UNAUTHORIZED: &str = "unauthorized";

/// A network error as a person can act on it: the cause, not just "error
/// sending request". Walks the error's source chain for the root cause.
pub fn describe(error: &reqwest::Error) -> String {
    let mut chain = vec![error.to_string()];
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        chain.push(cause.to_string());
        source = cause.source();
    }
    let all = chain.join(": ").to_lowercase();
    let hint = if all.contains("dns") || all.contains("failed to lookup") || all.contains("nodename nor servname") {
        "Servername nicht gefunden (DNS). Stimmt die Adresse, und sind Sie im Firmennetz bzw. VPN?"
    } else if all.contains("certificate") || all.contains("ssl") || all.contains("tls") {
        "Dem Zertifikat des Servers wird nicht vertraut."
    } else if error.is_timeout() || all.contains("timed out") {
        "Keine Antwort vom Server (Zeitüberschreitung)."
    } else if error.is_connect() {
        "Keine Verbindung zum Server."
    } else {
        "Netzwerkfehler."
    };
    format!("{hint} ({})", chain.last().map(String::as_str).unwrap_or_default())
}

pub struct Middleware {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Middleware {
    pub fn new(base: &str, token: &str) -> Self {
        Middleware { http: reqwest::Client::new(), base: base.to_string(), token: token.to_string() }
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.http.request(method, format!("{}{}", self.base, path)).bearer_auth(&self.token)
    }

    /// Error bodies are `{ error: <Klartext>, code?: <stabiler Code> }` (routes of the middleware).
    async fn checked(response: Result<Response, reqwest::Error>) -> Result<Response, String> {
        let response = response.map_err(|e| describe(&e))?;
        match response.status() {
            StatusCode::UNAUTHORIZED => Err(UNAUTHORIZED.into()),
            status if status.is_success() => Ok(response),
            status => {
                let detail = response
                    .json::<Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
                    .unwrap_or_default();
                Err(if detail.is_empty() { format!("Die Middleware meldet HTTP {}.", status.as_u16()) } else { detail })
            }
        }
    }

    async fn get_json(&self, path: &str) -> Result<Value, String> {
        let response = Self::checked(self.request(Method::GET, path).send().await).await?;
        response.json().await.map_err(|e| e.to_string())
    }

    /// Identity, grants, agent availability and consent state (`GET /api/desktop/session`).
    pub async fn session(&self) -> Result<Value, String> {
        self.get_json("/api/desktop/session").await
    }

    /// The admin's model catalogue (`GET /api/models` → `{ models, defaultModel }`).
    pub async fn models(&self) -> Result<Value, String> {
        self.get_json("/api/models").await
    }

    /// Records the person's consent to server-side data access; `datasource` covers views too.
    pub async fn consent(&self, scope: &str) -> Result<(), String> {
        let mut body = json!({ "accept": true });
        if scope == "datasource" {
            body["scope"] = json!("datasource");
        }
        Self::checked(self.request(Method::POST, "/api/tableau-server/consent").json(&body).send().await).await?;
        Ok(())
    }

    pub async fn logout(&self) {
        let _ = self.request(Method::POST, "/api/auth/logout").send().await;
    }

    /// One chat turn over `POST /api/desktop/chat`. Every SSE event (`delta`,
    /// `tool`, `consent_required`, `notice`, `final`, `done`, `error`) is
    /// passed to `channel` as `{ "type": <event>, ...data }`.
    pub async fn chat_stream(&self, body: &Value, channel: &Channel<Value>) -> Result<(), String> {
        let response = Self::checked(self.request(Method::POST, "/api/desktop/chat").json(body).send().await).await?;
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or_default();
        if !content_type.contains("text/event-stream") {
            return Err("Die Antwort der Middleware ist kein Event-Stream — Server-Adresse prüfen.".into());
        }
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| describe(&e))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk).replace("\r\n", "\n"));
            while let Some(end) = buffer.find("\n\n") {
                let frame: String = buffer.drain(..end + 2).collect();
                if let Some(event) = parse_frame(&frame) {
                    let _ = channel.send(event);
                }
            }
        }
        if let Some(event) = parse_frame(&buffer) {
            let _ = channel.send(event);
        }
        Ok(())
    }
}

/// One SSE frame (`event: <name>` + `data: <json>` lines) as `{ "type": <name>, ...data }`;
/// `ping` frames and anything that is not a JSON object are dropped.
fn parse_frame(frame: &str) -> Option<Value> {
    let mut event = "message".to_string();
    let mut data = String::new();
    for line in frame.lines() {
        if let Some(name) = line.strip_prefix("event:") {
            event = name.trim().to_string();
        } else if let Some(payload) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(payload.trim_start());
        }
    }
    if event == "ping" || data.is_empty() {
        return None;
    }
    let parsed: Value = serde_json::from_str(&data).ok()?;
    let mut object: Map<String, Value> = parsed.as_object()?.clone();
    object.insert("type".into(), Value::String(event));
    Some(Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_host_is_reported_as_dns() {
        let error = reqwest::get("https://ovp.does-not-exist.invalid/healthz").await.unwrap_err();
        assert!(describe(&error).starts_with("Servername nicht gefunden (DNS)"), "{}", describe(&error));
    }

    #[test]
    fn parses_named_events_and_skips_pings_and_garbage() {
        assert_eq!(parse_frame("event: delta\ndata: {\"content\":\"Hi\"}\n\n"), Some(json!({"type": "delta", "content": "Hi"})));
        assert_eq!(parse_frame("event: ping\ndata: {}\n\n"), None);
        assert_eq!(parse_frame(": keepalive\n\n"), None);
        assert_eq!(parse_frame("event: delta\ndata: not json\n\n"), None);
    }
}
