const core = require("@actions/core");
const github = require("@actions/github");
const https = require("https");

async function run() {
  try {
    // Read inputs
    const webhookUrl = core.getInput("webhook-url", { required: true });
    const title = core.getInput("title", { required: true });
    const description = core.getInput("description");
    const color = parseInt(core.getInput("color"), 10) || 3447003;
    const fieldsRaw = core.getInput("fields");
    const footer = core.getInput("footer");
    const embedUrl = core.getInput("url");
    const thumbnailUrl = core.getInput("thumbnail-url");

    // Parse fields JSON
    let fields = [];
    if (fieldsRaw) {
      try {
        fields = JSON.parse(fieldsRaw);
      } catch (e) {
        core.warning(`Failed to parse fields JSON: ${e.message}`);
      }
    }

    // Auto-add GitHub context fields
    const ctx = github.context;
    fields.push(
      {
        name: "Repository",
        value: `${ctx.repo.owner}/${ctx.repo.repo}`,
        inline: true,
      },
      {
        name: "Workflow",
        value: ctx.workflow,
        inline: true,
      },
      {
        name: "Run",
        value: `[#${ctx.runNumber}](${ctx.serverUrl}/${ctx.repo.owner}/${ctx.repo.repo}/actions/runs/${ctx.runId})`,
        inline: true,
      }
    );

    // Build Discord embed payload
    const payload = {
      embeds: [
        {
          title,
          description: description || undefined,
          url: embedUrl || undefined,
          color,
          fields,
          footer: { text: footer },
          timestamp: new Date().toISOString(),
          thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
        },
      ],
    };

    // Send to Discord
    const result = await postToDiscord(webhookUrl, payload);

    core.setOutput("status", result.statusCode);
    core.setOutput("message-id", result.messageId || "");
    core.info(`✅ Discord notification sent (HTTP ${result.statusCode})`);
  } catch (error) {
    core.setFailed(`Discord notification failed: ${error.message}`);
  }
}

/**
 * POST a payload to a Discord webhook URL.
 * Uses native https to avoid extra dependencies.
 */
function postToDiscord(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(`${webhookUrl}?wait=true`);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Discord API error ${res.statusCode}: ${body}`));
        } else {
          let messageId = "";
          try {
            messageId = JSON.parse(body).id;
          } catch {}
          resolve({ statusCode: res.statusCode, messageId });
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

run();
