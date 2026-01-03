# LightJoy Docker Guide

This directory contains the necessary files to run LightJoy in a Docker container.

## Prerequisites
*   [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

## Quick Start

1.  Open a terminal in this directory (`docker/`).
2.  Run the following command to build and start the container:

    ```bash
    docker compose up --build
    ```

    *   The `--build` flag ensures that the image is rebuilt if you changed any source code.
    *   The build context is set to the project root, so it will compile the fresh code from `../`.

3.  Access the web interface at:
    *   **https://localhost:8080**
    *   Or **https://[YOUR_PC_IP]:8080**

## Configuration
*   **Credentials**: The default username/password is set to `user` in `entrypoint.sh`.
*   **Data Persistence**: Server data (paired hosts, keys) is stored in the `server-data` folder in the project root (`../server-data`). This ensures your pairing info is not lost when you restart the container.

## Troubleshooting
*   **First Run Slowness**: The first time you run this, Docker has to download the Rust and Node.js images and compile the entire project. This can take 5-10 minutes. Subsequent runs will be faster.
*   **Ports**: Ensure ports 8080, 47984, 47989, and 48010 are not being used by other applications.
