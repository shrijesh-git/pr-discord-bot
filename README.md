# PR Discord Bot — GitHub App (Actions-Hosted)

A **serverless GitHub App** that runs entirely on GitHub Actions — no external server needed. It auto-labels PRs by size, posts review checklists, handles `/deploy` slash commands, and sends rich notifications to Discord.

## Architecture

```
GitHub Event → Actions Workflow (github-script) → GitHub API + Discord Webhook
```

No server, no Docker, no hosting costs. The workflow **is** the app.

## Features

| Event | Action |
|---|---|
| PR Opened | Adds size labels (`size/S`, `size/M`, `size/L`, `size/XL`) |
| PR Opened | Posts a welcome comment with review checklist |
| PR Merged | Sends Discord embed with merge details |
| Review Submitted | Sends Discord notification with reviewer & state |
| Comment `/deploy` | Permission check → triggers `repository_dispatch` for deploy |

## Repository Structure

```
pr-discord-bot/
├── app-logic.js                          # Core webhook handler logic
├── .github/
│   ├── actions/
│   │   └── discord-notify/               # Custom Action (LOCAL)
│   │       ├── action.yml
│   │       ├── index.js
│   │       ├── package.json
│   │       └── dist/index.js             # Compiled (committed)
│   └── workflows/
│       ├── app.yml                       # ← The "hosted" GitHub App
│       └── ci-deploy.yml                 # ← CI/CD using local action
```

## Setup

### 1. Discord Webhook
1. Discord Server → Settings → Integrations → Webhooks → **New Webhook**
2. Copy the webhook URL
3. Add as repo secret: **`DISCORD_WEBHOOK_URL`**

### 2. GitHub Workflow Permissions
1. Go to repo → Settings → Actions → General
2. Under "Workflow permissions", select **Read and write permissions**

### 3. Test It
Open a PR and watch:
- The `app.yml` workflow labels the PR and posts a checklist comment
- A Discord embed appears in your channel
- The `ci-deploy.yml` pipeline sends build status to Discord

## Custom Action: discord-notify

Located at `.github/actions/discord-notify/`, this action is referenced by local path:

```yaml
- uses: ./.github/actions/discord-notify
  with:
    webhook-url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    title: "Build Passed ✅"
    color: "3066993"
```

### Action Inputs

| Input | Required | Description |
|---|---|---|
| `webhook-url` | Yes | Discord webhook URL |
| `title` | Yes | Embed title |
| `description` | No | Embed description |
| `color` | No | Embed color (decimal). Default: `3447003` (blue) |
| `fields` | No | JSON array: `[{"name":"key","value":"val","inline":true}]` |
| `url` | No | URL link in the title |
| `footer` | No | Footer text. Default: `GitHub Actions` |

### Color Reference

| Color | Decimal | Use Case |
|---|---|---|
| Green | `3066993` | Success, deployed |
| Red | `15158332` | Failure, security issues |
| Blue | `3447003` | Info, PR opened |
| Orange | `15105570` | Warning, large PR |
| Purple | `10181046` | PR merged |
| Amber | `15964178` | Deploy triggered |

## Making the Action Reusable (Optional)

To share the action across repos, extract `.github/actions/discord-notify/` into its own repo and reference it as:

```yaml
uses: yourorg/discord-notify-action@v1
```

## License

MIT
