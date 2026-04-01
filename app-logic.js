const https = require("https");

/**
 * GitHub App (Actions-Hosted) - PR Discord Bot
 * Handles webhook events via github-script in GitHub Actions.
 * No Probot, no server — just pure logic.
 */
async function handleEvent(eventName, payload, octokit) {
  console.log(`Processing event: ${eventName}.${payload.action}`);

  if (eventName === "pull_request" && payload.action === "opened") {
    await handlePROpened(payload, octokit);
  } else if (
    eventName === "pull_request" &&
    payload.action === "closed" &&
    payload.pull_request.merged
  ) {
    await handlePRMerged(payload, octokit);
  } else if (
    eventName === "pull_request_review" &&
    payload.action === "submitted"
  ) {
    await handleReview(payload, octokit);
  } else if (
    eventName === "issue_comment" &&
    payload.action === "created"
  ) {
    await handleComment(payload, octokit);
  } else {
    console.log(`No handler for ${eventName}.${payload.action}`);
  }
}

// ─── PR Opened ───────────────────────────────────────────────
async function handlePROpened(payload, octokit) {
  const pr = payload.pull_request;
  const repo = payload.repository;

  // Calculate size label based on lines changed
  const linesChanged = pr.additions + pr.deletions;
  let sizeLabel = "size/S";
  let color = 0x2ecc71; // green

  if (linesChanged > 500) {
    sizeLabel = "size/XL";
    color = 0xe74c3c; // red
  } else if (linesChanged > 200) {
    sizeLabel = "size/L";
    color = 0xe67e22; // orange
  } else if (linesChanged > 50) {
    sizeLabel = "size/M";
    color = 0xf1c40f; // yellow
  }

  // Apply size label via GitHub API
  await octokit.rest.issues.addLabels({
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: pr.number,
    labels: [sizeLabel],
  });

  // Post review checklist comment
  await octokit.rest.issues.createComment({
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: pr.number,
    body: [
      `👋 Thanks for the PR, @${pr.user.login}!`,
      "",
      "**Review Checklist:**",
      "- [ ] Tests added/updated",
      "- [ ] Docs updated",
      "- [ ] No secrets committed",
      "- [ ] Changelog entry added",
      "",
      `_Auto-labeled: \`${sizeLabel}\` (${linesChanged} lines changed)_`,
    ].join("\n"),
  });

  // Send Discord notification
  await sendDiscord({
    title: `📬 New PR in ${repo.full_name}`,
    description: pr.title,
    url: pr.html_url,
    color,
    fields: [
      { name: "Author", value: pr.user.login, inline: true },
      { name: "Size", value: `${sizeLabel} (${linesChanged} lines)`, inline: true },
      { name: "Branch", value: `${pr.head.ref} → ${pr.base.ref}`, inline: false },
    ],
  });

  console.log(`✅ Processed PR #${pr.number} — labeled ${sizeLabel}`);
}

// ─── PR Merged ───────────────────────────────────────────────
async function handlePRMerged(payload, octokit) {
  const pr = payload.pull_request;

  await sendDiscord({
    title: `✅ PR Merged in ${payload.repository.full_name}`,
    description: pr.title,
    url: pr.html_url,
    color: 0x9b59b6, // purple
    fields: [
      { name: "Merged By", value: pr.merged_by.login, inline: true },
      { name: "Commits", value: `${pr.commits}`, inline: true },
    ],
  });

  console.log(`✅ Processed merge for PR #${pr.number}`);
}

// ─── Review Submitted ────────────────────────────────────────
async function handleReview(payload, octokit) {
  const review = payload.review;
  const pr = payload.pull_request;

  const emoji = {
    approved: "✅",
    changes_requested: "🔄",
    commented: "💬",
  };

  await sendDiscord({
    title: `${emoji[review.state] || "📝"} Review on PR #${pr.number}`,
    description: `${review.user.login} ${review.state.replace("_", " ")}`,
    url: review.html_url,
    color: review.state === "approved" ? 0x2ecc71 : 0xe74c3c,
    fields: [
      { name: "PR", value: pr.title, inline: false },
      { name: "Reviewer", value: review.user.login, inline: true },
      { name: "State", value: review.state, inline: true },
    ],
  });

  console.log(`✅ Processed review on PR #${pr.number} — ${review.state}`);
}

// ─── Slash Command: /deploy ──────────────────────────────────
async function handleComment(payload, octokit) {
  const comment = payload.comment.body.trim();
  if (comment !== "/deploy") return;

  const repo = payload.repository;
  const user = payload.comment.user.login;

  // Check if commenter has write access
  const { data: perm } =
    await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner: repo.owner.login,
      repo: repo.name,
      username: user,
    });

  if (!["admin", "write"].includes(perm.permission)) {
    await octokit.rest.issues.createComment({
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: payload.issue.number,
      body: "⛔ You don't have permission to deploy.",
    });
    console.log(`❌ Deploy denied for ${user} — permission: ${perm.permission}`);
    return;
  }

  // Trigger repository dispatch event (picked up by deploy workflow)
  await octokit.rest.repos.createDispatchEvent({
    owner: repo.owner.login,
    repo: repo.name,
    event_type: "deploy-command",
    client_payload: {
      pr_number: payload.issue.number,
      triggered_by: user,
    },
  });

  // Confirm in the PR
  await octokit.rest.issues.createComment({
    owner: repo.owner.login,
    repo: repo.name,
    issue_number: payload.issue.number,
    body: "🚀 Deployment triggered! Watch the Actions tab.",
  });

  // Notify Discord
  await sendDiscord({
    title: "🚀 Deployment Triggered",
    description: `PR #${payload.issue.number}`,
    url: payload.issue.html_url,
    color: 0xf39c12, // amber
    fields: [
      { name: "Triggered By", value: user, inline: true },
      { name: "Repository", value: repo.full_name, inline: true },
    ],
  });

  console.log(`✅ Deploy triggered by ${user} for PR #${payload.issue.number}`);
}

// ─── Discord Webhook Helper ──────────────────────────────────
function sendDiscord({ title, description, url, color, fields }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("⚠️ DISCORD_WEBHOOK_URL not set, skipping notification");
    return Promise.resolve();
  }

  const data = JSON.stringify({
    embeds: [
      {
        title,
        description,
        url,
        color,
        fields,
        footer: { text: "GitHub App • PR Discord Bot (Actions-hosted)" },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  return new Promise((resolve, reject) => {
    const parsed = new URL(webhookUrl);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode < 400) {
            console.log(`Discord notification sent (HTTP ${res.statusCode})`);
            resolve();
          } else {
            reject(new Error(`Discord API error ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

module.exports = { handleEvent };
