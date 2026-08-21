use anyhow::{bail, Result};

use crate::events::MatchBatch;

pub struct Uploader {
    client: reqwest::blocking::Client,
    base_url: String,
    token: String,
}

impl Uploader {
    pub fn new(base_url: String, token: String) -> Self {
        Self {
            client: reqwest::blocking::Client::new(),
            base_url,
            token,
        }
    }

    pub fn upload_batch(&self, batch: &MatchBatch) -> Result<()> {
        let url = format!("{}/matches/ingest", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.token)
            .json(batch)
            .send()?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().unwrap_or_default();
            bail!("upload failed: {status} - {body}");
        }
        Ok(())
    }
}
