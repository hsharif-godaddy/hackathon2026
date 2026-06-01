//! Dependency prove-out smoke test for the strangler-fig migration.
//!
//! Exercises the exact stack PR #3 will use to put airo-workspace in front of
//! the Go binary on a Unix socket: tokio runtime, hyper 1.x server + client,
//! the `hyper_util::rt::TokioIo` bridge, `http_body_util` body collection,
//! and a real request body streamed over the wire.
//!
//! UnixListener works on macOS and Linux, so this test runs locally
//! via `cargo test` (or `make test-rust`) and in the CI Rust test job.

use std::convert::Infallible;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::client::conn::http1 as client_http1;
use hyper::server::conn::http1 as server_http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::{UnixListener, UnixStream};

const PAYLOAD: &[u8] = b"hello strangler!";

#[tokio::test]
async fn hyper_server_and_client_round_trip_over_unix_socket() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let sock_path = dir.path().join("smoke.sock");

    let listener = UnixListener::bind(&sock_path).expect("bind unix socket");

    let server = tokio::spawn(async move {
        let (stream, _addr) = listener.accept().await.expect("accept");
        let io = TokioIo::new(stream);
        server_http1::Builder::new()
            .serve_connection(
                io,
                service_fn(|req: Request<Incoming>| async move {
                    let body = req
                        .into_body()
                        .collect()
                        .await
                        .expect("collect request body")
                        .to_bytes();
                    let resp = Response::builder()
                        .status(StatusCode::OK)
                        .body(Full::new(Bytes::from(format!("got {} bytes", body.len()))))
                        .expect("build response");
                    Ok::<_, Infallible>(resp)
                }),
            )
            .await
            .expect("serve_connection");
    });

    let stream = UnixStream::connect(&sock_path)
        .await
        .expect("client connect");
    let io = TokioIo::new(stream);
    let (mut sender, conn) = client_http1::handshake(io).await.expect("client handshake");
    // Drive the client's http1 connection. server.abort() below tears the
    // server side down mid-keep-alive, which surfaces here as a connection
    // error — expected, not a test failure, so we discard the result.
    tokio::spawn(async move {
        let _ = conn.await;
    });

    let req = Request::builder()
        .method("POST")
        .uri("/")
        .body(Full::new(Bytes::from_static(PAYLOAD)))
        .expect("build request");

    let resp = sender.send_request(req).await.expect("send_request");
    assert_eq!(resp.status(), StatusCode::OK);

    let body = resp
        .into_body()
        .collect()
        .await
        .expect("collect response body")
        .to_bytes();
    assert_eq!(
        body.as_ref(),
        format!("got {} bytes", PAYLOAD.len()).as_bytes(),
    );

    // hyper http1 keep-alive holds the server's serve_connection open until
    // the client side closes. The smoke test only needs the round-trip to
    // succeed; aborting cleans up without forcing a connection-close header
    // that real callers won't send.
    server.abort();
}
