//! Sign-in through the organisation's SSO, as a native app (RFC 8252): the
//! browser runs the IdP login the middleware is configured for
//! (`GET /api/auth/config`), the IdP redirects to the middleware's usual
//! `/auth/callback`, and that page -- recognising the `desktop-<port>-…`
//! state -- sends the code on to a one-shot listener on
//! `127.0.0.1:<random port>/callback`. The app then trades code plus PKCE
//! verifier for the ID token (`POST /api/auth/exchange`), exactly like the
//! extension does. No change to the IdP's redirect URIs is needed.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn pkce() -> Pkce {
    let mut bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Pkce { verifier, challenge }
}

/// The state the callback page recognises: `desktop-<port>-<random>`.
pub fn desktop_state(port: u16) -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("desktop-{port}-{}", URL_SAFE_NO_PAD.encode(bytes))
}

/// A listener on a free loopback port.
pub async fn listen() -> Result<(TcpListener, u16), String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    Ok((listener, port))
}

/// `GET /api/auth/config` of the middleware -- the SSO parameters the extension uses too.
#[derive(Debug, Deserialize)]
pub struct LoginConfig {
    pub mode: String,
    #[serde(rename = "authorizationEndpoint")]
    pub authorization_endpoint: Option<String>,
    #[serde(rename = "clientId")]
    pub client_id: Option<String>,
    pub scopes: Option<String>,
    #[serde(rename = "redirectUri")]
    pub redirect_uri: Option<String>,
    pub provider: Option<String>,
    pub error: Option<String>,
}

pub async fn login_config(server: &str) -> Result<LoginConfig, String> {
    let response = reqwest::Client::new()
        .get(format!("{server}/api/auth/config"))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| crate::api::describe(&e))?;
    let config: LoginConfig = response.json().await.map_err(|_| "Ungültige Antwort der Middleware (/api/auth/config).".to_string())?;
    if let Some(error) = &config.error {
        return Err(error.clone());
    }
    if config.mode != "oidc" {
        return Err("Die Desktop-App braucht Single Sign-On (OIDC) — in der Admin-UI unter „Anmeldung“ einrichten.".into());
    }
    if config.authorization_endpoint.is_none() || config.client_id.is_none() || config.redirect_uri.is_none() {
        return Err("Die SSO-Konfiguration der Middleware ist unvollständig.".into());
    }
    Ok(config)
}

/// The IdP's authorization URL, built like the extension builds it.
pub fn authorization_url(config: &LoginConfig, state: &str, challenge: &str) -> Result<String, String> {
    let mut url = url::Url::parse(config.authorization_endpoint.as_deref().unwrap_or_default()).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", config.client_id.as_deref().unwrap_or_default());
        query.append_pair("redirect_uri", config.redirect_uri.as_deref().unwrap_or_default());
        query.append_pair("scope", config.scopes.as_deref().unwrap_or("openid profile email"));
        query.append_pair("state", state);
        query.append_pair("code_challenge", challenge);
        query.append_pair("code_challenge_method", "S256");
        if config.provider.as_deref() == Some("entra") {
            query.append_pair("prompt", "select_account");
        }
    }
    Ok(url.into())
}

/// Waits for the browser to arrive at `/callback?code=…&state=…` with the
/// expected state and returns the code.
pub async fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    tokio::time::timeout(LOGIN_TIMEOUT, accept_code(listener, expected_state))
        .await
        .map_err(|_| "Die Anmeldung wurde nicht innerhalb von 5 Minuten abgeschlossen.".to_string())?
}

async fn accept_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buffer = vec![0u8; 8192];
        let mut read = 0;
        while read < buffer.len() {
            let n = stream.read(&mut buffer[read..]).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            read += n;
            if buffer[..read].windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        let request = String::from_utf8_lossy(&buffer[..read]);
        let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or("");
        let parsed = url::Url::parse(&format!("http://127.0.0.1{target}")).ok().filter(|url| url.path() == "/callback");
        let param = |name: &str| parsed.as_ref().and_then(|url| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned()));
        let state_ok = param("state").as_deref() == Some(expected_state);
        let outcome: Option<Result<String, String>> = match (parsed.is_some(), state_ok, param("code"), param("error")) {
            (false, _, _, _) => None,
            (true, false, _, _) => Some(Err("Anmeldung konnte nicht zugeordnet werden — bitte erneut anmelden.".into())),
            (true, true, _, Some(error)) if error == "access_denied" => Some(Err("Anmeldung abgebrochen.".into())),
            (true, true, _, Some(error)) => Some(Err(format!("Anmeldung fehlgeschlagen ({error})."))),
            (true, true, Some(code), None) => Some(Ok(code)),
            (true, true, None, None) => Some(Err("Anmeldung fehlgeschlagen (kein Code).".into())),
        };

        let (status, body) = match &outcome {
            Some(Ok(_)) => ("200 OK", DONE_PAGE),
            Some(Err(_)) => ("200 OK", FAILED_PAGE),
            None => ("404 Not Found", ""),
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;
        if let Some(result) = outcome {
            return result;
        }
    }
}

const DONE_PAGE: &str = r#"<!doctype html><html lang="de"><meta charset="utf-8"><title>OpenVizPilot</title>
<body style="font:15px -apple-system,'Segoe UI',sans-serif;display:grid;place-items:center;height:90vh;color:#1d1d1f">
<div style="text-align:center"><h1 style="font-size:20px">Bei OpenVizPilot angemeldet</h1>
<p>Sie können dieses Fenster schließen und zur OpenVizPilot-App zurückkehren.</p>
<p style="color:#6e6e73">Signed in to OpenVizPilot. You can close this window.</p></div></body></html>"#;

const FAILED_PAGE: &str = r#"<!doctype html><html lang="de"><meta charset="utf-8"><title>OpenVizPilot</title>
<body style="font:15px -apple-system,'Segoe UI',sans-serif;display:grid;place-items:center;height:90vh;color:#1d1d1f">
<div style="text-align:center"><h1 style="font-size:20px">Anmeldung nicht abgeschlossen</h1>
<p>Die OpenVizPilot-App zeigt den Grund. Sie können dieses Fenster schließen.</p></div></body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_s256_of_the_verifier() {
        let p = pkce();
        assert_eq!(p.verifier.len(), 64);
        assert_eq!(p.challenge.len(), 43);
        assert_eq!(p.challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier.as_bytes())));
    }

    #[test]
    fn state_carries_the_port_in_the_shape_the_callback_page_expects() {
        let state = desktop_state(54321);
        assert!(state.starts_with("desktop-54321-"));
        let random = &state["desktop-54321-".len()..];
        assert_eq!(random.len(), 32);
        assert!(random.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn builds_the_authorization_url_like_the_extension() {
        let config = LoginConfig {
            mode: "oidc".into(),
            authorization_endpoint: Some("https://idp.example/authorize".into()),
            client_id: Some("client".into()),
            scopes: Some("openid profile".into()),
            redirect_uri: Some("https://ovp.example/auth/callback".into()),
            provider: Some("entra".into()),
            error: None,
        };
        let url = authorization_url(&config, "desktop-1-abc", "chal").unwrap();
        assert!(url.starts_with("https://idp.example/authorize?response_type=code&client_id=client&redirect_uri=https%3A%2F%2Fovp.example%2Fauth%2Fcallback&scope=openid+profile&state=desktop-1-abc&code_challenge=chal&code_challenge_method=S256&prompt=select_account"), "{url}");
    }

    #[tokio::test]
    async fn listener_returns_the_code_for_the_expected_state_only() {
        let (listener, port) = listen().await.unwrap();
        let wait = tokio::spawn(async move { wait_for_code(listener, "desktop-1-expected").await });
        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}");
        assert_eq!(client.get(format!("{base}/favicon.ico")).send().await.unwrap().status(), 404);
        let ok = client.get(format!("{base}/callback?code=abc%2B1&state=desktop-1-expected")).send().await.unwrap();
        assert_eq!(ok.status(), 200);
        assert_eq!(wait.await.unwrap().unwrap(), "abc+1");

        let (listener, port) = listen().await.unwrap();
        let wait = tokio::spawn(async move { wait_for_code(listener, "desktop-1-expected").await });
        let wrong = client.get(format!("http://127.0.0.1:{port}/callback?code=abc&state=other")).send().await.unwrap();
        assert_eq!(wrong.status(), 200);
        assert!(wait.await.unwrap().is_err());
    }
}
