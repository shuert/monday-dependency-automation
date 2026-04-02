# monday-dependency-automation

A monday.com integration app that automatically activates dependent tasks when a parent task is marked **Done** — but only if the dependent task isn't already Done.

## What it does

```
When: Item Status changes to "Done"
Then: For each item in its Dependency column...
        IF dependent item status ≠ "Done"
        THEN set dependent item status → "Working on it"
```

---

## Stack

- Node.js + Express
- Hosted on Digital Ocean App Platform
- Connects to monday.com via webhook + GraphQL API

---

## Setup Guide

### Step 1 — Create the monday App

1. Go to [monday Developer Center](https://monday.com/developers/apps) (your avatar → Developers)
2. Click **Create app**
3. Give it a name (e.g. "Dependency Activator")
4. Under **OAuth & Permissions → Scopes**, add:
   - `boards:read`
   - `boards:write`
5. Under **Features**, click **Add Feature → Integration**
6. Create a new recipe:
   - **Trigger:** "When status changes to something" → select your Done status
   - **Action:** (custom — this app handles it via webhook)
7. Go to **Basic Information** and copy your:
   - **Signing Secret** → this is `MONDAY_SIGNING_SECRET`
8. Go to **Tokens** and generate an **API Token** → this is `MONDAY_API_TOKEN`

---

### Step 2 — Clone and configure the project

```bash
git clone <your-repo-url>
cd monday-dependency-automation
npm install
cp .env.example .env
```

Edit `.env`:
```
MONDAY_SIGNING_SECRET=from_developer_center
MONDAY_API_TOKEN=from_developer_center
PORT=3000
```

---

### Step 3 — Deploy to Digital Ocean App Platform

1. Push this repo to GitHub
2. In Digital Ocean → **Apps → Create App**
3. Connect your GitHub repo
4. Set the **Run Command** to: `npm start`
5. Add environment variables (from `.env`) under **Settings → Environment Variables**:
   - `MONDAY_SIGNING_SECRET`
   - `MONDAY_API_TOKEN`
6. Deploy — Digital Ocean will give you a URL like `https://your-app.ondigitalocean.app`

---

### Step 4 — Register the Webhook URL in monday

1. Back in monday Developer Center → your app → **Features → Integration**
2. In your recipe's action, set the **Webhook URL** to:
   ```
   https://your-app.ondigitalocean.app/webhook
   ```
3. monday will send a challenge request — the app handles this automatically

---

### Step 5 — Install the app on your board

1. In Developer Center → **Install** → install to your workspace
2. Go to your board → **Automate → Integrate**
3. Find your custom integration and configure:
   - Which **Status column** to watch
   - Confirm the "Done" value matches exactly (default: `"Done"`)

---

## Local Development

Install the [monday CLI](https://developer.monday.com/apps/docs/cli):

```bash
npm install -g @mondaycom/apps-cli
mapps tunnel:create
```

This gives you a public HTTPS tunnel URL to use during development instead of your Digital Ocean URL.

Then run:
```bash
npm run dev
```

---

## Configuration

If your board uses different status label text, update these constants in `src/handler.js`:

```js
const DONE_LABEL = "Done";        // The trigger status
const ACTIVATE_LABEL = "Working on it";  // What to set dependents to
```

Labels are **case-sensitive** and must match exactly what appears in your monday board.

---

## Project Structure

```
src/
  index.js        → Express server, route definitions
  handler.js      → Core automation logic
  mondayClient.js → GraphQL queries & mutations
  verify.js       → Webhook signature verification
.env.example      → Environment variable template
```

---

## How the Dependency column is read

This app reads monday's **native Dependency column** using the `DependencyValue` GraphQL type, which exposes `linked_item_ids`. All linked items share the same board, so the same status column ID applies to both parent and dependent items.
