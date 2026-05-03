# Tsion ERP Deployment

This repo is ready for two practical deployment paths:

1. Render + Render Postgres + Cloudflare R2
2. Railway + Railway Postgres + AWS S3

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

## What Must Exist Before Go-Live

1. A PostgreSQL database with schema applied.
2. An object storage bucket for uploads, PDFs, and Excel exports.
3. A Google Maps API key if you want map features enabled.
4. Real company details in env vars.

## Post-Deploy Smoke Test

Check these routes after deployment:
- /api/health
- /api/supermarkets
- /api/inventory/summary
- /api/uploads/attachments

Then test these actions in the UI:
- Add a supermarket
- Add stock
- Create a delivery
- Upload an attachment
- Generate a receipt PDF
- Export receivables

## Important Notes

1. FRONTEND_URL must match the deployed app origin because the backend CORS policy checks it.
2. If you host on a platform that restarts often, keep FILE_STORAGE_DRIVER=s3.
3. Do not commit any real .env file or storage credentials.
4. If an old password was ever exposed in local files, rotate it before production.
