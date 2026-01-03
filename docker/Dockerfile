# Stage 1: Build Frontend
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app

# Install git for submodules (if needed globally, though we copy files)
RUN apt-get update && apt-get install -y git

# Copy entire repository to ensure submodules and relative paths work
COPY . .

# Initialize submodules (just in case they weren't copied correctly or are needed)
# Note: config says "git submodule update", so we do it to be safe.
# If .git is excluded, this fails, so we assume .git is part of context.
# However, for safety if .git is huge, we often rely on pre-checkout.
# But user insisted on the command.
RUN git submodule update --init --recursive

# Build Frontend
WORKDIR /app/moonlight-web/web-server
RUN npm install
RUN npm run build

# Stage 2: Build Backend
FROM rust:bookworm AS backend-builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    clang \
    libssl-dev \
    pkg-config \
    git \
    protobuf-compiler

# Copy source from previous stage (or fresh copy)
COPY . .

# Ensure submodules (again, to be safe for Rust build if it depends on them)
RUN git submodule update --init --recursive

# Build Streamer (Explicit User Request)
RUN cargo build --release --bin streamer

# Build Web Server
WORKDIR /app/moonlight-web/web-server
RUN cargo build --release --bin web-server

# Stage 3: Runtime
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Binaries
COPY --from=backend-builder /app/target/release/web-server /app/web-server
COPY --from=backend-builder /app/target/release/streamer /app/streamer

# Copy Frontend Assets
COPY --from=frontend-builder /app/moonlight-web/web-server/dist /app/dist

# Copy Entrypoint
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose Ports
# 8080: Web Interface
# 47984: HTTPS Control
# 47989: HTTP Control/Pairing
# 48010: RTSP
# 47998-48000: Video/Audio Streams (UDP)
EXPOSE 8080 47984 47989 48010 47998 47999 48000/udp

# Define Volume for Config/Data
VOLUME ["/app/server"]

ENTRYPOINT ["/app/entrypoint.sh"]
