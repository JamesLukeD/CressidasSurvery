# Manuka Honey Gentell — Registration Form

A registration form for Manuka Honey Gentell education/training sessions.  
**Stack:** Static HTML/CSS/JS · Azure Static Web Apps · Azure Functions (Node.js 18 / TypeScript) · SharePoint list · Microsoft Graph API

---

## Architecture

```
Browser (HTML/CSS/JS)
        │  POST /api/register (JSON)
        ▼
Azure Static Web Apps  ──▶  Azure Functions (Node.js 18)
                                    │
                          ┌─────────┴───────────┐
                          ▼                     ▼
                 SharePoint List         Graph API sendMail
               (registration store)   (confirmation + notification)
```

---

## ⚠️ Before You Begin — Required Setup

The following must be provisioned **before** deploying. The application will not function without them.

### 1. Azure AD App Registration

Create an app registration in Azure AD with **application permissions** (not delegated), admin-consented:

| Permission            | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `Mail.Send`           | Send confirmation emails from the service account mailbox |
| `Sites.ReadWrite.All` | Write registration data to SharePoint list                |

Note the **Tenant ID**, **Client ID**, and create a **Client Secret**.

### 2. SharePoint List

Create a SharePoint list (any name — referenced by ID) with the following columns. **Internal names must match exactly** — these are used by the Graph API.

| Display Name               | Internal Name               | Column Type                            |
| -------------------------- | --------------------------- | -------------------------------------- |
| Title _(built-in)_         | `Title`                     | Single line of text — stores Full Name |
| Email Address              | `EmailAddress`              | Single line of text                    |
| Trust / Organisation       | `TrustOrganisation`         | Single line of text                    |
| Profession / Role          | `ProfessionRole`            | Single line of text                    |
| Department / Specialty     | `DepartmentSpecialty`       | Single line of text                    |
| Place of Work              | `PlaceOfWork`               | Single line of text                    |
| Preferred Session Date     | `PreferredSessionDate`      | Single line of text                    |
| Session Format             | `SessionFormat`             | Single line of text                    |
| Willing To Be Contacted    | `WillingToBeContacted`      | Yes/No                                 |
| Contact Phone Number       | `ContactPhoneNumber`        | Single line of text                    |
| Accessibility Requirements | `AccessibilityRequirements` | Multiple lines of text                 |
| How Did You Hear           | `HowDidYouHear`             | Single line of text                    |
| GDPR Consent               | `GDPRConsent`               | Yes/No                                 |
| Submitted At               | `SubmittedAt`               | Date and Time                          |

> **Tip:** After creating columns, verify internal names via Graph API:  
> `GET https://graph.microsoft.com/v1.0/sites/{siteId}/lists/{listId}/columns`

### 3. Azure Static Web Apps Resource

Provision an **Azure Static Web Apps** resource in the Azure portal with:

- **API runtime:** Node.js 18
- Functions enabled (Dedicated or Standard plan required for custom APIs)

---

## Environment Variables

Configure in `api/local.settings.json` for local development, and in **Azure Static Web Apps → Configuration → Application settings** for production.

| Variable               | Description                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `AZURE_TENANT_ID`      | Azure AD tenant ID (GUID)                                                                         |
| `AZURE_CLIENT_ID`      | App registration client ID (GUID)                                                                 |
| `AZURE_CLIENT_SECRET`  | App registration client secret                                                                    |
| `SHAREPOINT_SITE_ID`   | SharePoint site ID — see _Getting IDs_ below                                                      |
| `SHAREPOINT_LIST_ID`   | SharePoint list ID (GUID)                                                                         |
| `SENDER_EMAIL`         | M365 mailbox used to send emails (must be licensed, `Mail.Send` permission applied via app reg)   |
| `ORGANISER_EMAIL`      | _(optional)_ Email address to receive registration notifications                                  |
| `JOINING_LINK_15_JULY` | Microsoft Teams link for 15 July session                                                          |
| `JOINING_LINK_21_JULY` | Microsoft Teams link for 21 July session                                                          |
| `JOINING_LINK_23_JULY` | Microsoft Teams link for 23 July session                                                          |
| `SESSION_TIME_15_JULY` | Display time for 15 July, e.g. `10:00 – 12:00`                                                    |
| `SESSION_TIME_21_JULY` | Display time for 21 July                                                                          |
| `SESSION_TIME_23_JULY` | Display time for 23 July                                                                          |
| `SESSION_LOCATION`     | Venue for in-person sessions (shown in confirmation email)                                        |
| `ALLOWED_ORIGIN`       | CORS origin for local dev, e.g. `http://localhost:4280`; use `*` in production (SWA handles CORS) |

---

## Getting SharePoint IDs

### Site ID

```bash
# Replace with your tenant hostname and site path
curl -H "Authorization: Bearer <token>" \
  "https://graph.microsoft.com/v1.0/sites/yourtenant.sharepoint.com:/sites/yoursite"
# Copy the "id" field from the response
```

### List ID

```bash
curl -H "Authorization: Bearer <token>" \
  "https://graph.microsoft.com/v1.0/sites/<siteId>/lists?$filter=displayName eq 'YourListName'"
# Copy the "id" field from the matching list in the response
```

You can obtain a token using the [Microsoft Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) or the Azure CLI:

```bash
az account get-access-token --resource https://graph.microsoft.com
```

---

## Local Development

### Prerequisites

- Node.js 18+
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local): `npm install -g azure-functions-core-tools@4`
- [Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/): `npm install -g @azure/static-web-apps-cli`

### 1. Install API dependencies

```bash
cd api
npm install
```

### 2. Configure local settings

```bash
cp api/local.settings.json.example api/local.settings.json
# Edit api/local.settings.json with your real values — this file is gitignored
```

### 3. Start the application

```bash
# From the project root — SWA CLI proxies both the static site and /api/*
swa start . --api-location api
```

The site will be available at **http://localhost:4280**.

The SWA CLI compiles TypeScript automatically when starting via `--api-location`. If you prefer to compile manually:

```bash
cd api && npm run build
```

---

## Deployment

### Deploy via GitHub Actions (recommended)

1. Push code to a GitHub repository.
2. In the Azure portal, create a **Static Web App** and connect it to the repository.
3. Set build configuration:
   - **App location:** `/`
   - **API location:** `api`
   - **Output location:** `/`
4. Azure will auto-generate a GitHub Actions workflow that builds and deploys on push.
5. Add all environment variables under **Azure Static Web Apps → Configuration → Application settings**.

### Manual deployment (Azure CLI)

```bash
az staticwebapp create \
  --name manuka-honey-gentell \
  --resource-group <your-rg> \
  --source <your-github-repo-url> \
  --location "West Europe" \
  --branch main \
  --app-location "/" \
  --api-location "api" \
  --output-location "/"
```

---

## Customising Session Dates

To update or add session dates:

1. Update the radio button values and labels in `index.html` (Section 3).
2. Add corresponding environment variables for joining links and session times.
3. Update `getJoiningLink()`, `getSessionTime()`, and `formatSessionDate()` in [`api/src/functions/register.ts`](api/src/functions/register.ts).
4. Redeploy.

---

## Security Notes

- **`api/local.settings.json` is gitignored** — never commit it; it contains credentials.
- Server-side validation runs independently of client-side validation — do not remove it.
- All user input is sanitised (angle brackets stripped, length-capped) before being written to SharePoint or included in HTML emails.
- A **honeypot field** is included as a lightweight anti-bot measure. The server returns a fake success response when triggered.
- For higher-traffic events, consider:
  - **Azure API Management** with rate limiting policies
  - **Azure Front Door WAF** for IP-based throttling
  - Integrating a CAPTCHA service (e.g. [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/), [hCaptcha](https://www.hcaptcha.com/))
- The app registration should follow **least privilege**: only `Mail.Send` and `Sites.ReadWrite.All`.
- Rotate the client secret before it expires and update the application setting in Azure.

---

## Project Structure

```
VirtualMeetingManuka/
├── index.html                  # Registration form (single page)
├── css/
│   └── styles.css              # NHS-inspired styles
├── js/
│   └── form.js                 # Client-side validation & fetch submission
├── staticwebapp.config.json    # Azure SWA routing configuration
├── .gitignore
├── README.md
└── api/
    ├── host.json               # Azure Functions host configuration
    ├── package.json
    ├── tsconfig.json
    ├── local.settings.json.example   # Copy to local.settings.json and fill in
    └── src/
        └── functions/
            └── register.ts     # HTTP-triggered Azure Function (POST /api/register)
```
