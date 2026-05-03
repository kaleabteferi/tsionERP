# Tsion ERP Deployment

This repo is ready for practical deployment paths:

1. Render + Render Postgres + Cloudflare R2
2. Railway + Railway Postgres + AWS S3
3. Oracle Cloud Free Tier VM + Docker Compose
4. Firebase Hosting only (local browser data mode)

## Option 1: Render + R2

Files to use:
- render.yaml
- backend/.env.render-r2.example

Steps:
1. Push this repo to GitHub.
2. In Render, create a new Blueprint deployment from the repo.
3. Render will create:
   - one Node web service
   - one PostgreSQL database
4. In the web service settings, fill the remaining env vars from backend/.env.render-r2.example.
5. Create a Cloudflare R2 bucket named tsion-erp-files or your preferred bucket name.
6. Create an R2 API token and paste the access key and secret into Render.
7. Open the Render shell for the web service and run:
   - cd /opt/render/project/src/backend
   - node db/setup.js
8. Open https://your-app.onrender.com/api/health and confirm it returns status ok.
9. Open the app URL and add your first real data.

Recommended Render values:
- FILE_STORAGE_DRIVER=s3
- S3_REGION=auto
- S3_FORCE_PATH_STYLE=false
- FRONTEND_URL=https://your-app.onrender.com

## Option 2: Railway + AWS S3

Files to use:
- railway.json
- backend/.env.railway-s3.example

Steps:
1. Push this repo to GitHub.
2. In Railway, create a new project from the repo.
3. Add a PostgreSQL service.
4. Railway will build the app using railway.json.
5. In the app service variables, fill the values from backend/.env.railway-s3.example.
6. Create an S3 bucket and IAM credentials with access only to that bucket.
7. In the Railway app shell, run:
   - cd /app/backend
   - node db/setup.js
8. Open https://your-app.up.railway.app/api/health and confirm it returns status ok.
9. Open the app URL and add your first real data.

Recommended Railway values:
- FILE_STORAGE_DRIVER=s3
- S3_ENDPOINT=
- S3_FORCE_PATH_STYLE=false
- FRONTEND_URL=https://your-app.up.railway.app

## Option 3: Oracle Cloud Free Tier VM

Files to use:
- docker-compose.yml
- Dockerfile
- backend/.env.oracle-free.example

Why this option fits this app:
- one always-free VM can run both the Node app and PostgreSQL
- local Docker volumes can persist uploads and generated PDFs
- no separate S3 service is required unless you want off-server backups

Recommended VM shape:
- Oracle Cloud Always Free Ampere A1
- Ubuntu 22.04 or 24.04
- 1 to 2 OCPU
- 6 to 12 GB RAM if available in your tenancy

### Step 1: Create the VM

1. Create an Oracle Cloud account.
2. Create a Compute instance using an Always Free eligible shape.
3. Choose Ubuntu.
4. Assign a public IPv4 address.
5. Save your SSH private key locally.

### Step 2: Open the Required Ports

In Oracle Cloud networking for that instance, allow inbound:
- TCP 22 for SSH
- TCP 3001 for the app

If you later put Nginx in front, also allow:
- TCP 80
- TCP 443

### Step 3: SSH Into the VM

From your local machine:

```bash
ssh -i /path/to/your-key.pem ubuntu@YOUR_ORACLE_PUBLIC_IP
```

### Step 4: Install Docker and Docker Compose

On the Oracle VM:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
sudo usermod -aG docker $USER
newgrp docker
```

### Step 5: Pull the App From GitHub

```bash
git clone https://github.com/kaleabteferi/tsionERP.git
cd tsionERP
```

### Step 6: Create the Production Env File

```bash
cp backend/.env.oracle-free.example backend/.env
nano backend/.env
```

At minimum set:
- `DB_PASSWORD`
- `FRONTEND_URL=http://YOUR_ORACLE_PUBLIC_IP:3001`
- `GOOGLE_MAPS_API_KEY`
- company info values

Keep these values for Oracle local hosting:
- `FILE_STORAGE_DRIVER=local`
- `NODE_ENV=production`

### Step 7: Start the Stack

From the repo root on the VM:

```bash
docker compose up -d --build
```

This starts:
- the Node app on port 3001
- PostgreSQL on port 5432
- persistent Docker volumes for database, uploads, and generated PDFs

### Step 8: Apply the Database Schema

```bash
docker compose exec app node backend/db/setup.js
```

### Step 9: Verify the Deployment

```bash
curl http://YOUR_ORACLE_PUBLIC_IP:3001/api/health
```

You should get a JSON response with `status: ok`.

Your public app URL will be:

```text
http://YOUR_ORACLE_PUBLIC_IP:3001
```

### Optional Step 10: Add a Domain and HTTPS

If you want a cleaner link for phone and PC use:

1. Point a domain or subdomain to your Oracle VM public IP.
2. Install Nginx or Caddy on the VM.
3. Reverse proxy to `localhost:3001`.
4. Enable HTTPS with Let's Encrypt.

Without this step, the app still works over plain HTTP using the Oracle public IP.

### Update Workflow

When you push new code to GitHub:

```bash
cd ~/tsionERP
git pull
docker compose up -d --build
```

### Useful Maintenance Commands

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f db
docker compose restart app
```

### Oracle Notes

1. If port 3001 does not open publicly, check both Oracle security lists and the VM firewall.
2. Docker volumes keep your database and uploaded/generated files across restarts.
3. This is a better free fit for this app than static hosts because the backend and database stay together.

## Option 4: Firebase Hosting only

Key files:

- `firebase.json`
- `.firebaserc.example`
- `index.html`
- `tsion_erp_v2_full.html`

Behavior in this mode:

- The app runs without backend services.
- Data is stored in the browser localStorage for each device/browser.
- PDF/export/upload endpoints are disabled and show a clear message in the UI.

Deploy commands:

```bash
firebase use <your-project-id>
firebase deploy --only hosting
```

## What Must Exist Before Go-Live

1. A configured data backend:
   - PostgreSQL with schema applied for Node/Express deployments, or
   - browser localStorage for Firebase Hosting-only deployments.
2. A configured file backend:
   - object storage (S3) for backend deployments, or
   - persistent local disk where applicable.
3. A Google Maps API key if you want map features enabled.
4. Real company details in env vars.

## Post-Deploy Smoke Test

For backend deployments, check these routes:
- /api/health
- /api/supermarkets
- /api/inventory/summary
- /api/uploads/attachments

For Firebase Hosting-only deployments, open the app URL and verify the status chip shows Local.

Then test these actions in the UI:
- Add a supermarket
- Add stock
- Create a delivery
- Record a payment

For backend deployments only, also test:
- Upload an attachment
- Generate a receipt PDF
- Export receivables

## Important Notes

1. FRONTEND_URL must match the deployed app origin because the backend CORS policy checks it.
2. If you host on a platform that restarts often, keep FILE_STORAGE_DRIVER=s3.
3. Do not commit any real .env file or storage credentials.
4. If an old password was ever exposed in local files, rotate it before production.
