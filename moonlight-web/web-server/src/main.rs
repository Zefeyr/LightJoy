use common::config::{Config, ConfigSsl};
use openssl::ssl::{SslAcceptor, SslFiletype, SslMethod};
use openssl::rsa::Rsa;
use openssl::x509::X509;
use openssl::asn1::Asn1Time;
use openssl::pkey::PKey;
use std::{io::ErrorKind, path::Path};
use tokio::{
    fs,
    io::{AsyncBufReadExt, BufReader, stdin},
};

use actix_web::{App, HttpServer, web::Data, dev::Service};
use log::{LevelFilter, info};
use serde::{Serialize, de::DeserializeOwned};
use simplelog::{ColorChoice, TermLogger, TerminalMode};

use crate::{
    api::{api_service, auth::ApiCredentials},
    data::{ApiData, RuntimeApiData},
    web::{web_config_js_service, web_service},
};

mod api;
mod data;
mod web;

#[actix_web::main]
async fn main() {
    #[cfg(debug_assertions)]
    let log_level = LevelFilter::Debug;
    #[cfg(not(debug_assertions))]
    let log_level = LevelFilter::Info;

    TermLogger::init(
        log_level,
        simplelog::Config::default(),
        TerminalMode::Mixed,
        ColorChoice::Auto,
    )
    .expect("failed to init logger");

    if let Err(err) = main2().await {
        info!("Error: {err:?}");
    }

    exit().await.expect("exit failed")
}

async fn exit() -> Result<(), anyhow::Error> {
    info!("Press Enter to close this window");

    let mut line = String::new();
    let mut reader = BufReader::new(stdin());

    reader.read_line(&mut line).await?;

    Ok(())
}

async fn main2() -> Result<(), anyhow::Error> {
    // Load Config
    let mut config = read_or_default::<Config>("./server/config.json").await;
    if config.credentials.as_deref() == Some("default") {
        info!("Enter your credentials in the config (server/config.json)");

        return Ok(());
    }

    // Ensure streamer exists
    ensure_streamer_exists(&mut config).await?;
    
    // Ensure certificates exist
    ensure_certificates_exist(&mut config).await?;

    let credentials = Data::new(ApiCredentials {
        credentials: config.credentials.clone(),
    });

    let config = Data::new(config);

    // Load Data
    let data = read_or_default::<ApiData>(&config.data_path).await;
    let data = RuntimeApiData::load(&config, data).await;

    let bind_address = config.bind_address;
    let server = HttpServer::new({
        let config = config.clone();

        move || {
            App::new()
                .app_data(config.clone())
                .app_data(credentials.clone())
                .wrap_fn(|req, srv| {
                    info!("[Middleware] Incoming: {} {} Headers: {:?}", req.method(), req.path(), req.headers());
                    srv.call(req)
                })
                .service(api_service(data.clone()))
                .service(web_config_js_service())
                .service(web_service())
        }
    });

    if let Some(certificate) = config.certificate.as_ref() {
        info!("[Server]: Running Https Server with ssl tls");

        let mut builder = SslAcceptor::mozilla_intermediate(SslMethod::tls())
            .expect("failed to create ssl tls acceptor");
        builder
            .set_private_key_file(&certificate.private_key_pem, SslFiletype::PEM)
            .expect("failed to set private key");
        builder
            .set_certificate_chain_file(&certificate.certificate_pem)
            .expect("failed to set certificate");

        server.bind_openssl(bind_address, builder)?.run().await?;
    } else {
        server.bind(bind_address)?.run().await?;
    }

    Ok(())
}

async fn read_or_default<T>(path: impl AsRef<Path>) -> T
where
    T: DeserializeOwned + Serialize + Default,
{
    match fs::read_to_string(path.as_ref()).await {
        Ok(value) => serde_json::from_str(&value).expect("invalid file"),
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let value = T::default();

            let value_str = serde_json::to_string_pretty(&value).expect("failed to serialize file");

            if let Some(parent) = path.as_ref().parent() {
                fs::create_dir_all(parent)
                    .await
                    .expect("failed to create directories to file");
            }
            fs::write(path.as_ref(), value_str)
                .await
                .expect("failed to write default file");

            value
        }
        Err(err) => panic!("failed to read file: {err}"),
    }
}

async fn ensure_streamer_exists(config: &mut Config) -> Result<(), anyhow::Error> {
    if Path::new(&config.streamer_path).exists() {
        return Ok(());
    }

    // Check workspace default location fallback
    let workspace_target = if cfg!(windows) {
        "../../target/release/streamer.exe"
    } else {
        "../../target/release/streamer"
    };

    if Path::new(workspace_target).exists() {
        info!("Streamer binary found at workspace target: {}. Updating config.", workspace_target);
        config.streamer_path = workspace_target.to_string();
        
        // Save the updated config to file
        let value_str = serde_json::to_string_pretty(&config).expect("failed to serialize config");
        tokio::fs::write("./server/config.json", value_str).await.expect("failed to update config file");
        
        return Ok(());
    }

    info!("Streamer binary not found at {:?} or {}. Attempting to build...", config.streamer_path, workspace_target);
    
    let status = tokio::process::Command::new("cargo")
        .args(&["build", "--release", "--bin", "streamer"])
        .current_dir("../../") // Assuming running from web-server dir, need to go up to workspace root
        .status()
        .await?;

    if !status.success() {
        return Err(anyhow::anyhow!("Failed to build streamer binary"));
    }
    
    if Path::new(&config.streamer_path).exists() {
         info!("Streamer binary built successfully at configured path.");
         return Ok(());
    }

    if Path::new(workspace_target).exists() {
         info!("Streamer binary built successfully at workspace target. Updating config.");
         config.streamer_path = workspace_target.to_string();
         
         // Save the updated config to file
         let value_str = serde_json::to_string_pretty(&config).expect("failed to serialize config");
         tokio::fs::write("./server/config.json", value_str).await.expect("failed to update config file");
         
         return Ok(());
    }
    
    Err(anyhow::anyhow!("Streamer binary still not found after build at {:?} or {}", config.streamer_path, workspace_target))
}

async fn ensure_certificates_exist(config: &mut Config) -> Result<(), anyhow::Error> {
    if config.certificate.is_some() {
        return Ok(());
    }

    info!("Certificates not found in config. Generating self-signed certificates...");

    // Generate Key
    let rsa = Rsa::generate(2048)?;
    let pkey = PKey::from_rsa(rsa)?;
    
    let private_key_pem = String::from_utf8(pkey.private_key_to_pem_pkcs8()?)?;

    // Generate Cert
    let mut x509 = X509::builder()?;
    x509.set_version(2)?;
    x509.set_pubkey(&pkey)?; 
    
    // Valid for 1 year
    let not_before = Asn1Time::days_from_now(0)?;
    let not_after = Asn1Time::days_from_now(365)?;
    x509.set_not_before(&not_before)?;
    x509.set_not_after(&not_after)?;
    
    // Self-signed with the same key
    x509.sign(&pkey, openssl::hash::MessageDigest::sha256())?;
    
    let certificate_pem = String::from_utf8(x509.build().to_pem()?)?;

    // Create certs directory
    tokio::fs::create_dir_all("./server/certs").await?;
    tokio::fs::write("./server/certs/key.pem", &private_key_pem).await?;
    tokio::fs::write("./server/certs/cert.pem", &certificate_pem).await?;

    config.certificate = Some(ConfigSsl {
        private_key_pem: "./server/certs/key.pem".to_string(),
        certificate_pem: "./server/certs/cert.pem".to_string(),
    });

    info!("Generated self-signed certificates at ./server/certs/");

    // Save the updated config to file
    let value_str = serde_json::to_string_pretty(&config).expect("failed to serialize config");
    tokio::fs::write("./server/config.json", value_str).await.expect("failed to update config file");

    Ok(())
}
