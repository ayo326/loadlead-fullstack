---
connie-title: 'Operations - IAM Infrastructure Runbook'
connie-publish: true
---

# IAM Infrastructure Runbook

> Step-by-step ops guide for the four remaining infra items after the IAM
> code lands:
>
> 1. `admin.loadleadapp.com` subdomain
> 2. WAF IP allow-list in front of it
> 3. Separate admin-only frontend bundle
> 4. Resend production API key

Everything below assumes you are running from a machine with the
`loadlead-deploy` AWS profile that already deploys backend + frontend.

---

## 1. Separate admin-only frontend bundle

This has to ship first - the new CloudFront distribution in step 2
points at it. Keeping the admin code out of the customer bundle is
defense in depth: if an attacker reaches `loadleadapp.com`, the admin
routes are not even in the JS they download.

### 1a. Add an admin build target to Vite

`frontend-v2/vite.config.ts` already builds `dist/`. Add an env-gated
variant that emits `dist-admin/` containing only the admin shell.

```ts
// frontend-v2/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isAdmin = process.env.LL_BUILD === 'admin';
  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    define: {
      'import.meta.env.LL_ADMIN_BUILD': JSON.stringify(isAdmin),
    },
    build: {
      outDir: isAdmin ? 'dist-admin' : 'dist',
      // The admin entry point uses a tighter route table; the
      // customer entry never imports it, and vice versa.
      rollupOptions: {
        input: isAdmin
          ? path.resolve(__dirname, 'admin.html')
          : path.resolve(__dirname, 'index.html'),
      },
    },
  };
});
```

### 1b. Add a slim admin entry HTML + script

```html
<!-- frontend-v2/admin.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex,nofollow" />
    <title>LoadLead Admin</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/admin-main.tsx"></script></body>
</html>
```

```tsx
// frontend-v2/src/admin-main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { RequireAuth, RequireRole } from './components/RequireAuth';
import { AppLayout } from './layouts/AppLayout';
import Login from './pages/Login';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import './index.css';

// NO customer routes here. NO Landing. NO Signup. The admin bundle
// only knows how to render the login screen and the admin console.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login adminOnly />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/admin" element={<RequireRole role="ADMIN"><AdminDashboard /></RequireRole>} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

### 1c. Build script

Add to `frontend-v2/package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "build:admin": "LL_BUILD=admin vite build"
  }
}
```

### 1d. Add a deploy script for the admin bundle

`deploy-admin-frontend.sh` (alongside the existing `deploy-frontend.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
[[ "${APP_ENV:-}" == "production" ]] || { echo "APP_ENV must be production"; exit 1; }

ADMIN_BUCKET="${ADMIN_BUCKET:-loadlead-admin-prod}"
ADMIN_DIST_ID="${ADMIN_DIST_ID:?set ADMIN_DIST_ID to the CloudFront distribution ID}"

cd frontend-v2
npm ci
npm run build:admin

aws s3 sync dist-admin/ "s3://$ADMIN_BUCKET/" --delete --cache-control 'public,max-age=300,must-revalidate'
aws cloudfront create-invalidation --distribution-id "$ADMIN_DIST_ID" --paths '/*'
echo "Admin bundle live at admin.loadleadapp.com"
```

---

## 2. `admin.loadleadapp.com` subdomain

### 2a. Provision an isolated S3 bucket

```bash
aws s3api create-bucket \
  --bucket loadlead-admin-prod \
  --region us-east-1
aws s3api put-public-access-block \
  --bucket loadlead-admin-prod \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

(Block-public is on; CloudFront will reach the bucket through an Origin
Access Control, not over the public Internet.)

### 2b. Issue an ACM cert in us-east-1 for `admin.loadleadapp.com`

```bash
aws acm request-certificate \
  --domain-name admin.loadleadapp.com \
  --validation-method DNS \
  --region us-east-1
```

Take the returned `CertificateArn` and the DNS validation record from
`aws acm describe-certificate`. Add the CNAME validation record to
Route53 (or whichever DNS provider hosts `loadleadapp.com`).

### 2c. CloudFront distribution

Create a new distribution. Key non-default settings:

| Setting | Value |
|---|---|
| Origin | `loadlead-admin-prod.s3.us-east-1.amazonaws.com` (S3 type, via OAC) |
| Alternate domain name | `admin.loadleadapp.com` |
| SSL certificate | the ACM cert from 2b |
| Default root object | `admin.html` |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Allowed HTTP methods | GET, HEAD, OPTIONS |
| Cache policy | `CachingOptimized` (managed) |
| Origin request policy | `Managed-CORS-S3Origin` |
| Response headers policy | `Managed-SecurityHeadersPolicy` + add `Content-Security-Policy: default-src 'self' https://api.loadleadapp.com; frame-ancestors 'none'` |
| Custom error responses | 403 + 404 -> `/admin.html` (200) for SPA routing |
| WAF Web ACL | (attach the one from step 3) |
| Logging | enable to a dedicated `loadlead-admin-cloudfront-logs` bucket |

Take note of the distribution ID; that goes into `ADMIN_DIST_ID` in the
deploy script and into your env vars.

### 2d. Update the S3 bucket policy

Once the distribution exists, copy the OAC ARN into the bucket policy
so only that distribution can read the bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::loadlead-admin-prod/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DIST_ID>"
      }
    }
  }]
}
```

### 2e. Route53 record

In the `loadleadapp.com` hosted zone, add an `A` alias record:

| Name | Type | Routing | Alias to |
|---|---|---|---|
| `admin` | A | Simple | `dxxxxxxx.cloudfront.net` (the new distribution) |

### 2f. CORS update on the backend

`backend/src/index.ts` already CORS-allows `loadleadapp.com`. Add the
admin origin so the admin bundle can call the API:

```ts
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'https://loadleadapp.com',
  'https://admin.loadleadapp.com',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);            // curl / server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed`));
  },
  credentials: true,
}));
```

Deploy backend after this change.

### 2g. Verify

```bash
# Cert presented and valid
curl -I https://admin.loadleadapp.com/ | head -5
# Returns 200 and serves the admin bundle, NOT the customer landing
curl -s https://admin.loadleadapp.com/ | grep -oE '<title>[^<]+'
# Expected: <title>LoadLead Admin
```

---

## 3. WAF IP allow-list in front of the admin distribution

This is the layer that says "even if someone has an ADMIN cookie, they
cannot reach the admin login page from outside our networks."

### 3a. Build the IP set

Collect every CIDR that ops, support, and oncall use:

* office network egress IP
* corporate VPN egress IPs
* personal VPN IPs you trust
* CI runner IP (only if CI needs to hit the admin surface; usually it
  does not - CI uses the backend API directly)

```bash
aws wafv2 create-ip-set \
  --name LoadLead-Admin-Allowlist \
  --scope CLOUDFRONT \
  --region us-east-1 \
  --ip-address-version IPV4 \
  --addresses 203.0.113.10/32 198.51.100.0/24
# Record the returned IPSetId + ARN.
```

### 3b. Create a Web ACL that defaults to BLOCK with one allow rule

```bash
cat > /tmp/admin-webacl.json <<'EOF'
{
  "Name": "LoadLead-Admin-WebACL",
  "Scope": "CLOUDFRONT",
  "DefaultAction": { "Block": {} },
  "VisibilityConfig": {
    "SampledRequestsEnabled": true,
    "CloudWatchMetricsEnabled": true,
    "MetricName": "LoadLeadAdminWebACL"
  },
  "Rules": [{
    "Name": "AllowFromAllowlist",
    "Priority": 0,
    "Action": { "Allow": {} },
    "Statement": {
      "IPSetReferenceStatement": {
        "ARN": "arn:aws:wafv2:us-east-1:<ACCOUNT>:global/ipset/LoadLead-Admin-Allowlist/<IPSetId>"
      }
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AllowFromAllowlist"
    }
  }]
}
EOF
aws wafv2 create-web-acl --region us-east-1 --cli-input-json file:///tmp/admin-webacl.json
# Record the returned WebACL ARN.
```

### 3c. Attach to the admin CloudFront distribution

In the CloudFront console for the admin distribution, set
"AWS WAF Web ACL" to `LoadLead-Admin-WebACL`. Save.

> CloudFront WAF changes propagate in ~5 minutes.

### 3d. Verify

```bash
# From an allow-listed IP
curl -I https://admin.loadleadapp.com/   # 200 OK

# From a non-allow-listed IP (e.g. a phone on cell data with VPN off)
curl -I https://admin.loadleadapp.com/   # 403 Forbidden by WAF
```

### 3e. Maintenance

* Add or remove CIDRs:
  ```bash
  aws wafv2 update-ip-set \
    --name LoadLead-Admin-Allowlist --scope CLOUDFRONT --region us-east-1 \
    --id <IPSetId> --lock-token <last-LockToken> \
    --addresses 203.0.113.10/32 198.51.100.0/24 192.0.2.55/32
  ```
* Watch denied requests:
  ```bash
  aws wafv2 get-sampled-requests \
    --web-acl-arn <WebACL ARN> --rule-metric-name AllowFromAllowlist \
    --scope CLOUDFRONT --region us-east-1 \
    --time-window StartTime=...,EndTime=... \
    --max-items 50
  ```

---

## 4. Resend production API key

We use Resend through `backend/src/services/integrations/email.ts`. The
adapter already handles both `live` and `stub` modes; production just
needs the key plus a verified sending domain.

### 4a. Create the Resend account + verify the sending domain

1. Sign in to [resend.com](https://resend.com) with the ops account.
2. **Domains -> Add domain** -> `loadleadapp.com`.
3. Resend shows you DNS records to add. Add them in Route53:
   * one **DKIM** TXT record at `resend._domainkey.loadleadapp.com`
   * one **SPF** TXT record at `loadleadapp.com` (or add
     `include:_spf.resend.com` to your existing SPF record - do not
     create a second SPF record on the same name; SPF spec only allows
     one)
   * one **DMARC** TXT record at `_dmarc.loadleadapp.com` if you do not
     already have one; start at `p=none` while we collect feedback.
4. Wait for the green check next to each record (DNS propagation; usually
   under 5 minutes on Route53).
5. **API Keys -> Create API Key** -> name it `loadlead-prod-server`,
   scope `Full access`, save the `re_...` value somewhere safe (Resend
   only shows it once).

### 4b. Set the env var on Elastic Beanstalk

```bash
aws elasticbeanstalk update-environment \
  --environment-name loadlead-backend-prod \
  --option-settings \
    'Namespace=aws:elasticbeanstalk:application:environment,OptionName=RESEND_API_KEY,Value=re_xxxxxxxx_xxxxxxxxxxxxxxxxxxxx' \
    'Namespace=aws:elasticbeanstalk:application:environment,OptionName=EMAIL_FROM,Value=noreply@loadleadapp.com'
```

(`EMAIL_FROM` must match a verified domain; the adapter falls back to
sandbox mode if either var is unset.)

### 4c. Verify mode

```bash
# Health endpoint already exposes the active mode for every adapter
curl -s https://api.loadleadapp.com/api/health | jq .integrations.email
# Expect: { "mode": "live", "ready": true }
```

If `mode: "stub"` or `ready: false`, the env var did not take effect -
double-check the spelling and that EB has finished applying the option
change.

### 4d. Send a real invitation to prove the chain

From the Carrier Members page (or `curl` against `/api/org/:orgId/invitations`),
send an invite to an email you control. Within ~30 seconds:

* The email arrives from `noreply@loadleadapp.com`.
* The accept link points at `https://loadleadapp.com/accept-invite?token=...`.
* `https://resend.com/emails` shows the message with status `delivered`.

### 4e. Rotation

Resend API keys are revocable. To rotate:

1. Create a new key in Resend (do not delete the old one yet).
2. `aws elasticbeanstalk update-environment ...` with the new value.
3. Wait for EB to settle, send a test invite.
4. Delete the old key in Resend.

---

## Order of operations

For a clean stand-up of all four items, do them in this order:

1. **Resend (4)** first - it is independent and easy to validate.
2. **Admin build (1)** next - this just adds a new build target; nothing
   in prod changes until the admin distribution exists.
3. **Admin subdomain (2)** - cert, CloudFront, S3, DNS, CORS. Verify the
   admin bundle loads at `admin.loadleadapp.com`.
4. **WAF (3)** last - tightens access. Easy to roll back by
   detaching the Web ACL from the distribution.

Each step is reversible until you switch DNS in 2e and attach the WAF
in 3c.
