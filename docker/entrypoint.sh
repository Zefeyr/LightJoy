#!/bin/bash
set -e

CONFIG_DIR="./server"
CONFIG_FILE="$CONFIG_DIR/config.json"
CERT_FILE="$CONFIG_DIR/cert.pem"
KEY_FILE="$CONFIG_DIR/key.pem"

# Create server directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Generate config.json if missing
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Generating default config.json..."
    cat > "$CONFIG_FILE" <<EOF
{
  "credentials": "user",
  "data_path": "server/data.json",
  "bind_address": "0.0.0.0:8080",
  "moonlight_default_http_port": 47989,
  "pair_device_name": "LightJoy-Docker",
  "webrtc_ice_servers": [
    {
      "urls": [
        "stun:l.google.com:19302"
      ],
      "username": "",
      "credential": ""
    }
  ],
  "webrtc_network_types": ["udp4", "udp6"],
  "web_path_prefix": "",
  "certificate": {
    "certificate_pem": "server/cert.pem",
    "private_key_pem": "server/key.pem"
  },
  "streamer_path": "/app/streamer"
}
EOF
fi

# Generate SSL certificates if missing
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "Generating self-signed SSL certificates..."
    openssl req -x509 -newkey rsa:4096 -keyout "$KEY_FILE" -out "$CERT_FILE" -days 365 -nodes -subj "/CN=LightJoy"
fi

echo "Starting LightJoy Web Server..."
exec ./web-server
