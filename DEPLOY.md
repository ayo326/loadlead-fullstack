# LoadLead — AWS Deployment Playbook
**Domain:** loadleadapp.com  
**Stack:** S3+CloudFront (frontend) · Elastic Beanstalk (backend) · DynamoDB · Route 53 · ACM

---

## Architecture

```
Users
  │
  ▼
Route 53 (loadleadapp.com)
  │
  ├── loadleadapp.com  ─────────────▶  CloudFront  ──▶  S3 (Vite dist/)
  │
  └── api.loadleadapp.com  ─────────▶  Elastic Beanstalk  ──▶  Node.js :4000
                                              │
                                              ▼
                                         DynamoDB (existing tables)
```

---

## Prerequisites

1. **AWS CLI v2** installed → https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html
2. **Configured** with your account:
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Key, Region (us-east-1), output (json)
   ```
3. **EB CLI** installed:
   ```bash
   pip install awsebcli
   ```

---

## Step 1 — SSL Certificate (ACM)  ⏱ 5 min

> **Must be in us-east-1** (CloudFront requires it).

1. Open **ACM Console** → https://console.aws.amazon.com/acm/home?region=us-east-1
2. Click **Request certificate** → Public certificate
3. Add domain names:
   - `loadleadapp.com`
   - `www.loadleadapp.com`
   - `api.loadleadapp.com`
4. Choose **DNS validation**
5. Click **Create records in Route 53** (one-click — auto-adds CNAME validation records)
6. Wait ~2 minutes for status to show **Issued**
7. **Copy the certificate ARN** — you'll need it for CloudFront

---

## Step 2 — Backend on Elastic Beanstalk  ⏱ 10 min

### 2a. Run the deploy script
```bash
cd /path/to/loadlead_fullstack_backup_20260211_222128
./deploy-backend.sh
```
This builds TypeScript, zips the backend, uploads to EB, and creates the environment.  
First deploy takes ~5 minutes.

### 2b. Set environment variables
In **EB Console** → Your environment → **Configuration** → **Environment properties**, add:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `JWT_SECRET` | *(generate: `openssl rand -hex 32`)* |
| `JWT_EXPIRES_IN` | `7d` |
| `ALLOWED_ORIGINS` | `https://loadleadapp.com,https://www.loadleadapp.com` |
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | *(your key)* |
| `AWS_SECRET_ACCESS_KEY` | *(your secret)* |
| `DYNAMODB_USERS_TABLE` | `LoadLead_Users` |
| `DYNAMODB_LOADS_TABLE` | `LoadLead_Loads` |
| `DYNAMODB_OFFERS_TABLE` | `LoadLead_Offers` |
| `DYNAMODB_DRIVERS_TABLE` | `LoadLead_Drivers` |
| `DYNAMODB_SHIPPERS_TABLE` | `LoadLead_Shippers` |
| `DYNAMODB_RECEIVERS_TABLE` | `LoadLead_Receivers` |
| `BROADCAST_RADIUS_MILES` | `50` |
| `OFFER_TTL_MINUTES` | `15` |
| `MIN_MC_MATURITY_DAYS` | `90` |

> **Note:** EB Node.js environments expect the app on port **8080**, not 4000. EB's nginx reverse-proxy handles the public port.

### 2c. Note the EB URL
After deploy, EB gives you a URL like:  
`loadlead-backend-prod.us-east-1.elasticbeanstalk.com`  
You'll use this in Step 4.

---

## Step 3 — Frontend on S3 + CloudFront  ⏱ 15 min

### 3a. Run the deploy script (first run creates the bucket)
```bash
./deploy-frontend.sh
```

### 3b. Create the CloudFront distribution
1. Open **CloudFront Console** → **Create distribution**
2. Settings:

| Setting | Value |
|---------|-------|
| Origin domain | `loadlead-frontend-prod.s3-website-us-east-1.amazonaws.com` |
| Origin protocol | HTTP only |
| Viewer protocol policy | **Redirect HTTP to HTTPS** |
| Allowed HTTP methods | GET, HEAD |
| Cache policy | CachingOptimized |
| Alternate domain names | `loadleadapp.com` and `www.loadleadapp.com` |
| Custom SSL certificate | *(select the ACM cert from Step 1)* |
| Default root object | `index.html` |

3. After creating, go to **Error pages** tab → Add:
   - HTTP error code: `403` → Response page: `/index.html` → HTTP response code: `200`
   - HTTP error code: `404` → Response page: `/index.html` → HTTP response code: `200`
   *(This makes React Router work — all paths serve index.html)*

4. **Copy the Distribution ID** (e.g. `E1ABCDEF123456`)

### 3c. Add the distribution ID to the deploy script
Edit `deploy-frontend.sh` and set:
```bash
CLOUDFRONT_DIST_ID="E1ABCDEF123456"   # ← your ID
```
Future deploys will automatically invalidate the cache.

---

## Step 4 — DNS in Route 53  ⏱ 5 min

Open **Route 53** → **Hosted zones** → `loadleadapp.com`

### Frontend records (Alias → CloudFront)
| Type | Name | Routes to |
|------|------|-----------|
| A (Alias) | `loadleadapp.com` | CloudFront distribution |
| A (Alias) | `www.loadleadapp.com` | CloudFront distribution |

### Backend record (CNAME → Elastic Beanstalk)
| Type | Name | Value |
|------|------|-------|
| CNAME | `api.loadleadapp.com` | `loadlead-backend-prod.us-east-1.elasticbeanstalk.com` |

> DNS propagates in 1–5 minutes with Route 53.

---

## Step 5 — Verify

```bash
# Backend health check
curl https://api.loadleadapp.com/api
# Expected: {"ok":true,"routes":[...]}

# Frontend
open https://loadleadapp.com
```

---

## Future Deployments

**Backend update:**
```bash
./deploy-backend.sh
```

**Frontend update:**
```bash
./deploy-frontend.sh
```

---

## IAM Permissions (least privilege)

The IAM user running the deploy scripts needs:
- `elasticbeanstalk:*` on your app/environment
- `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `loadlead-frontend-prod`
- `cloudfront:CreateInvalidation` on your distribution
- `acm:ListCertificates` (read-only)

The **EB EC2 instance role** needs:
- `dynamodb:*` on your LoadLead tables
- `s3:GetObject` on any S3 buckets the app reads from

---

## Costs (estimated)

| Service | Monthly cost |
|---------|-------------|
| Elastic Beanstalk (t3.small) | ~$15 |
| S3 (frontend static files) | < $1 |
| CloudFront (first 1TB free) | ~$0 first year |
| Route 53 hosted zone | $0.50 |
| ACM certificate | Free |
| DynamoDB (on-demand) | Pay per request |
| **Total** | **~$16–20/mo** |
