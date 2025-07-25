# GKE Resource Portal

A GCP resource optimization portal with recommendations and cost analysis.

## 🚀 Quick Start

### Setup
```bash
# 1. Set up GCP authentication
gcloud auth application-default login

# 2. Create environment files
cp templates/.env.backend backend/.env
cp templates/.env.frontend frontend/.env

# 3. Start services
cp $HOME/.config/gcloud/application_default_credentials.json gcp-credentials/gcp-key.json

# 4. Start services
docker compose up -d
```
