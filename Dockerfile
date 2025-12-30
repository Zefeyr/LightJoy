# Stage 1: Build Frontend
FROM node:20-bookworm-slim AS frontend
WORKDIR /app

# Copy package files
COPY moonlight-web/web-server/package.json moonlight-web/web-server/package-lock.json ./
# Install dependencies
RUN npm ci

# Copy frontend source
COPY moonlight-web/web-server/tsconfig.json ./
COPY moonlight-web/web-server/web ./web

# Build static assets (outputs to /app/dist)
RUN npm run build-light

# Stage 2: Build Backend
FROM rust:1.83-slim-bookworm AS backend
WORKDIR /app

# Install build dependencies for C crates
RUN apt-get update && apt-get install -y \
    clang \
    libclang-dev \
    libssl-dev \
    pkg-config \
    git \
    cmake \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace configuration
COPY Cargo.toml Cargo.lock ./

# Copy source crates
COPY moonlight-common ./moonlight-common
COPY moonlight-common-sys ./moonlight-common-sys
COPY moonlight-web ./moonlight-web

# Build the release binary
RUN cargo build --release --bin web-server

# Stage 3: Runtime
FROM debian:bookworm-slim
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary
COPY --from=backend /app/target/release/web-server /app/web-server

# Copy the static assets
COPY --from=frontend /app/dist /app/dist

# Expose ports
# 8080: HTTP/HTTPS
# 48010: Streaming (UDP) - Adjust range if needed based on config
EXPOSE 8080
EXPOSE 47998/udp 47999/udp 48000/udp 48002/udp 48010/udp

# Run the server
CMD ["/app/web-server"]
