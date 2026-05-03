# Firebase Deploy Guide (Exact Sequence)

This is the exact command flow to deploy this repo to Firebase Hosting + Functions + Firestore + Storage.

## 1. Create Firebase Project

1. Open https://console.firebase.google.com
2. Click `Create a project`
3. Project name: `tsion-erp` (or your preferred name)
4. Finish project creation
5. In the same project, enable:
   - Firestore Database
   - Storage
   - Hosting
   - Cloud Functions

Important:
- Cloud Functions deployment requires Firebase Blaze (pay-as-you-go) plan.
- Upgrade at: `https://console.firebase.google.com/project/<your-project-id>/usage/details`
- Open Firebase Storage in console once and click `Get Started` to initialize the bucket before deploying Storage rules.

## 2. Install Tools (One Time)

```bash
npm install -g firebase-tools
firebase login
```

## 3. Link Local Repo to Firebase Project

From repo root:

```bash
cp .firebaserc.example .firebaserc
```

Edit `.firebaserc` and replace:

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  }
}
```

with your real Firebase project ID.

## 4. Install Functions Dependencies

```bash
cd functions
npm install
cd ..
```

## 5. Set Function Environment Values

Copy env template:

```bash
cp functions/.env.example functions/.env
```

Set values in `functions/.env`:

- `COMPANY_NAME`
- `COMPANY_PHONE`
- `COMPANY_ADDRESS`
- `COMPANY_TIN`
- `COMPANY_TAGLINE`
- `FIREBASE_STORAGE_BUCKET=<your-project-id>.appspot.com`

## 6. Seed Initial Firestore Data

Use application default credentials for local seeding:

```bash
gcloud auth application-default login
```

Then seed:

```bash
cd functions
FIREBASE_PROJECT_ID=<your-project-id> FIREBASE_STORAGE_BUCKET=<your-project-id>.appspot.com npm run seed:firestore
cd ..
```

If you want to overwrite existing seed docs:

```bash
cd functions
FIREBASE_PROJECT_ID=<your-project-id> FIREBASE_STORAGE_BUCKET=<your-project-id>.appspot.com npm run seed:firestore:overwrite
cd ..
```

## 7. Deploy

From repo root:

```bash
firebase use <your-project-id>
firebase deploy --only firestore:rules,storage,functions,hosting
```

If Storage is not initialized yet, first open:

`https://console.firebase.google.com/project/<your-project-id>/storage`

Click `Get Started`, choose a location, then re-run deploy.

## 8. Verify

After deploy, open:

- `https://<your-project-id>.web.app`
- `https://<your-project-id>.web.app/api/health`

Expected health response includes:

```json
{"status":"ok"}
```

## 9. Update Workflow

After code changes:

```bash
git push
firebase deploy --only functions,hosting
```

If you changed Firestore or Storage rules:

```bash
firebase deploy --only firestore:rules,storage
```
