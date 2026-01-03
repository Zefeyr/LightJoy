# Lightjoy
**Lightjoy** is an enhanced, web-based [Moonlight Client](https://moonlight-stream.org/) optimized for mobile and low-latency streaming. It is based on [Moonlight-Web](https://github.com/MrCreativ3001/moonlight-web-stream).

It hosts a Web Server which forwards [Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/) traffic to a Browser using the [WebRTC Api](https://webrtc.org/).

![Lightjoy Screenshot](/readme/structure.png)

## Key Features
- **Customizable Touch Controls**: Drag and drop virtual gamepad buttons to suit your hand size and preference. Tap the **✏️ Pencil** icon to edit; your layout is saved automatically.
- **Low Latency Optimized**: Essential features only; haptic feedback removed to prioritize input speed and frame pacing on mobile devices.
- **Docker Support**: Deploy easily with a single command.
- **Split Layout**: Ergonomic controls designed for touchscreens.

## Overview

- [Images](#images)
- [Limitations](#limitations)
- [Installation](#installation)
- [Docker Deployment](#docker-deployment)
- [Setup](#setup)
  - [Streaming over the Internet](#streaming-over-the-internet)
  - [Configuring https](#configuring-https)
  - [Proxying via Apache 2](#proxying-via-apache-2)
- [Config](#config)
- [Contributors](#contributors)
- [Building](#building)

## Images

### Host List
![View: Hosts](/readme/hostView.jpg)

### Games List
![View: Games View](/readme/gamesView.jpg)

### Streaming
![View: Edit Mode with Draggable Buttons](/readme/stream_edit_mode.jpg)

### Customizable Controls (Edit Mode)
![View: Streaming, sidebar closed](/readme/stream.jpg)

## Limitations
- Features that only work in a [Secure Context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts#:~:text=They%20must%20be,be%20considered%20deprecated.) -> [How to configure a Secure Context / https](#configuring-https)
  - Controllers: [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
  - Keyboard Lock (allows to capture almost all keys also OS Keys): [Experimental Keyboard Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API)

## Docker Deployment (Recommended)


1.  **Install Docker** on your host machine.
2.  Navigate to the `docker` directory:
    ```bash
    cd docker
    ```
3.  Run the container:
    ```bash
    docker compose up --build
    ```
4.  Access the web interface at `https://localhost:8080`.

For more details, see [docker/README.md](docker/README.md).


## Installation (Manual)


1.  **Clone the repository** (ensure submodules are included):
    ```bash
    git clone --recursive https://github.com/Zefeyr/LightJoy.git
    # OR if already cloned:
    git submodule update --init --recursive
    ```

2.  **Build the Frontend**:
    ```bash
    cd moonlight-web/web-server
    npm install && npm run build
    cd ../..
    ```

3.  **Run the Server** (this will also build the backend binaries):
    ```bash
    cargo run --release --bin web-server
    ```

4.  Change your [access credentials](#credentials) in the newly generated `server/config.json` (requires restart).

5.  Go to `https://localhost:8080` (or `http` if configured).


## Setup

Add your pc:

1. Add a new pc (<img src="moonlight-web/web-server/web/resources/ic_add_to_queue_white_48px.svg" alt="icon" style="height:1em; vertical-align:middle;">) with the address as `localhost` and leave the port empty (if you've got the default port)

2. Pair your pc by clicking on the host (<img src="moonlight-web/web-server/web/resources/desktop_windows-48px.svg" alt="icon" style="height:1em; vertical-align:middle;">) and entering the code in sunshine

3. Launch an app

### Streaming over the Internet

1. Set the [bind address](#bind-address) to the one of your network and forward the web server port (default is 8080, http is 80, https is 443)

```json
{
    "bind_address": "192.168.1.1:80"
}
```

When in a local network the WebRTC Peers will negotatiate without any problems.
When you want to play to over the Internet the STUN servers included by default will try to negotiate the peers directly.
This works for most of the networks, but if your network is very restrictive it might not work.
If this is the case try to configure one or both of these options:
1. The most reliable and recommended way is to use a [turn server](#configure-a-turn-server)
2. [Forward the ports directly](#port-forward) (this might not work if the firewall blocks udp)

#### Configure a turn server
1. Host and configure a turn server like [coturn](https://github.com/coturn/coturn) or use other services to host one for you.

2. Add your turn server to your WebRTC Ice Server list
```json
{
    "webrtc_ice_servers": [
        {
            "urls": [
                    "stun:l.google.com:19302",
                    "stun:stun.l.google.com:19302",
                    "stun:stun1.l.google.com:19302",
                    "stun:stun2.l.google.com:19302",
                    "stun:stun3.l.google.com:19302",
                    "stun:stun4.l.google.com:19302",
            ]
        },
        {
            "urls": [
                    "turn:yourip.com:3478?transport=udp",
                    "turn:yourip.com:3478?transport=tcp",
                    "turn:yourip.com:5349?transport=tcp"
            ],
            "username": "your username",
            "credential": "your credential"
        }
    ]
}
```
Some (business) firewalls might be very strict and only allow tcp on port 443 for turn connections if that's the case also bind the turn server on port 443 and add `"turn:yourip.com:443?transport=tcp"` to the url's list.

#### Port forward

1. Set the port range used by the WebRTC Peer to a fixed range in the [config](#config)
```json
{
    "webrtc_port_range": {
        "min": 40000,
        "max": 40010
    }
}
```
2. Forward the port range specified in the previous step as `udp`.
If you're using Windows Defender make sure to allow NAT Traversal. Important: If your firewall blocks udp connections this won't work and you need to host a [turn server](#configure-a-turn-server)

3. Configure [WebRTC Nat 1 To 1](#webrtc-nat-1-to-1-ips) to advertise your [public ip](https://whatismyipaddress.com/) (Optional: WebRTC stun servers can usually automatically detect them):
```json
{
    "webrtc_nat_1to1": {
        "ice_candidate_type": "host",
        "ips": [
            "74.125.224.72"
        ]
    }
}
```

It might be helpful to look what kind of nat your pc is behind:
- [Nat Checker](https://www.checkmynat.com/)

### Configuring https
You can configure https directly with the Moonlight Web Server.

1. You'll need a private key and a certificate.

You can generate a self signed certificate with this python script [moonlight-web/web-server/generate_certificate.py](moonlight-web/web-server/generate_certificate.py):

```sh
pip install pyOpenSSL
python ./moonlight-web/web-server/generate_certificate.py
```

2. Copy the files `server/key.pem` and `server/cert.pem` into your `server` directory.

3. Modify the [config](#config) to enable https using the certificates
```json
{
    "certificate": {
        "private_key_pem": "./server/key.pem",
        "certificate_pem": "./server/cert.pem"
    }
}
```

### Proxying via Apache 2
It's possible to proxy the Moonlight Website using [Apache 2](https://httpd.apache.org/).

Note:
When you want to use https, the Moonlight Website should use http so that Apache 2 will handle all the https encryption.

1. Enable the modules `mod_proxy`, `mod_proxy_wstunnel`

```sh
sudo a2enmod mod_proxy mod_proxy_wstunnel
```

2. Create a new file under `/etc/apache2/conf-available/moonlight-web.conf` with the content:
```
# Example subpath "/moonlight" -> To connect you'd go to "http://yourip.com/moonlight/"
Define MOONLIGHT_SUBPATH /moonlight
# The address and port of your Moonlight Web server
Define MOONLIGHT_STREAMER YOUR_LOCAL_IP:YOUR_PORT

ProxyPreserveHost on
        
# Important: This WebSocket will help negotiate the WebRTC Peers
<Location ${MOONLIGHT_SUBPATH}/api/host/stream>
        ProxyPass ws://${MOONLIGHT_STREAMER}/api/host/stream
        ProxyPassReverse ws://${MOONLIGHT_STREAMER}/api/host/stream
</Location>

ProxyPass ${MOONLIGHT_SUBPATH}/ http://${MOONLIGHT_STREAMER}/
ProxyPassReverse ${MOONLIGHT_SUBPATH}/ http://${MOONLIGHT_STREAMER}/
```

3. Enable the created config file
```sh
sudo a2enconf moonlight-web
```

4. Change [config](#config) to include the [prefixed path](#web-path-prefix)
```json
{
    "web_path_prefix": "/moonlight"
}
```

5. Use https with a certificate (Optional)

## Config
The config file is under `server/config.json` relative to the executable.
Here are the most important settings for configuring Moonlight Web.

For a full list of values look into the [Rust Config module](moonlight-web/common/src/config.rs).

### Credentials
The credentials the Website will prompt you to enter.
Change this from the default value to the credentials for the website.

```json
{
    "credentials": "your password"
}
```

If you set this null authentication will be disabled and the `Authorization` header won't be used in requests.

```json
{
    "credentials": null
}
```

### Bind Address 
The address and port the website will run on

```json
{
    "bind_address": "127.0.0.1:8080"
}
```

### Https Certificates
If enabled the web server will use https with the provided certificate data

```json
{
    "certificate": {
        "private_key_pem": "./server/key.pem",
        "certificate_pem": "./server/cert.pem"
    }
}
```

### WebRTC Port Range
This will set the port range on the web server used to communicate when using WebRTC

```json
{
    "webrtc_port_range": {
        "min": 40000,
        "max": 40010
    }
}
```

### WebRTC Ice Servers
A list of ice servers for webrtc to use.

```json
{
    "webrtc_ice_servers": [
        {
            "urls": [
                    "stun:l.google.com:19302",
                    "stun:stun.l.google.com:19302",
                    "stun:stun1.l.google.com:19302",
                    "stun:stun2.l.google.com:19302",
                    "stun:stun3.l.google.com:19302",
                    "stun:stun4.l.google.com:19302",
            ]
        }
    ]
}
```

### WebRTC Nat 1 to 1 ips
This will advertise the ip as an ice candidate on the web server.
It's recommended to set this but stun servers should figure out the public ip.

`ice_candidate_type`:
- `host` -> This is the ip address of the server and the client can connect to
- `srflx` -> This is the public ip address of this server, like an ice candidate added from a stun server.

```json
{
    "webrtc_nat_1to1": {
        "ice_candidate_type": "host",
        "ips": [
            "74.125.224.72"
        ]
    }
}
```

### WebRTC Network Types
This will set the network types allowed by webrtc.
<br>Allowed values:
- udp4: All udp with ipv4
- udp6: All udp with ipv6
- tcp4: All tcp with ipv4
- tcp6: All tcp with ipv6

```json
{
    "webrtc_network_types": [
        "udp4",
        "udp6",
    ]
}
```

### Web Path Prefix
This is useful when rerouting the web page using services like [Apache 2](#proxying-via-apache-2).
Will always append the prefix to all requests made by the website.

```json
{
    "web_path_prefix": "/moonlight"
}
```

## Contributors
- Thanks to [@Argon2000](https://github.com/Argon2000) for implementing a canvas renderer, which makes this run in the Tesla browser.

## Building

See [Installation (Manual)](#installation-manual) for the quick build commands.

For cross-compilation or detailed crate information, see previous documentation or the `moonlight-web` repository.
