# ADR 0001: Desktop Technology Stack — Tauri, React, TypeScript, and Rust

- **Status**: Accepted
- **Date**: 2026-09-19
- **Author**: RemoteCommander Architecture Team
- **Context/Deciders**: Master Specification §0.2, §3

## Context

The system requires an AI-assisted desktop operations assistant that manages local resources and remote Linux/WHM/cPanel servers (including full root access). We evaluated two primary desktop stacks:

1. **Tauri (v2) + React + TypeScript + Rust + Tokio**
2. **Python 3 + PyQt6** (originally proposed in the Option B technical spike)
3. **Electron + Node.js**

Key technical and operational requirements:

- Native OS credential handling (Windows Credential Manager, macOS Keychain, Linux Secret Service).
- High performance, low footprint, and secure process isolation.
- Native PTY management for interactive terminal sessions (xterm.js).
- Direct SSH/SFTP socket management and concurrency via Tokio.
- Clear and unbypassable security boundary between the untrusted web UI / AI model outputs and privileged native OS operations.
- Cross-platform desktop packaging with strong security defaults.

## Decision

We adopt **Tauri + React + TypeScript + Rust (Tokio)** as the authoritative product baseline.

1. **Rust Core**: Privileged operations (SSH transport, PTY creation, filesystem access, credential store interactions, policy engine enforcement, audit logging) execute exclusively in Rust.
2. **React + TypeScript Frontend**: Provides a responsive, accessible chat, terminal, file manager, and server dashboard. The frontend never possesses raw secret credentials or direct execution authority.
3. **PyQt6/Python**: Relegated strictly to rapid-prototyping or disposable technical spikes. It is not part of the production distribution.
4. **Electron**: Rejected due to high resource overhead, bloated bundle sizes, and a larger attack surface.

## Consequences

### Positive

- **Strong Security Boundary**: Tauri's IPC mechanism enforces structured commands. Even if the frontend UI is compromised by untrusted content (e.g., prompt injection rendering malicious HTML), it cannot execute arbitrary OS calls without passing through the Rust command validation and policy engine.
- **Memory & Resource Efficiency**: Rust and native webview ensure minimal idle memory footprint (critical for background server monitoring).
- **Concurrency**: Tokio provides robust async I/O for handling multiple concurrent SSH sessions, file transfers, and streaming LLM responses.

### Negative / Trade-offs

- Higher initial build complexity and toolchain dependencies (Rust + Node.js toolchains required).
- Frontend webviews vary across OS platforms (WebView2 on Windows, WebKitGTK on Linux, WebKit on macOS), requiring cross-platform UI validation.
