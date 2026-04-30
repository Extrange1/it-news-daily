const express = require("express");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const Parser = require("rss-parser");
const nodemailer = require("nodemailer");

const app = express();
const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "IT News Daily/1.0"
  }
});

const PORT = process.env.PORT || 3030;
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const CACHE_PATH = path.join(DATA_DIR, "latest-news.json");

const defaultConfig = {
  appTitle: "IT News Daily",
  digestSize: 25,
  autoSendEnabled: false,
  sendTime: "08:00",
  timezone: "Europe/Lisbon",
  recipients: [],
  smtp: {
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    from: ""
  }
};

const newsSources = [
  { name: "Microsoft News", category: "Enterprise", url: "https://news.microsoft.com/feed/" },
  { name: "Google Cloud Blog", category: "Cloud", url: "https://cloudblog.withgoogle.com/rss/" },
  { name: "AWS News Blog", category: "Cloud", url: "https://aws.amazon.com/blogs/aws/feed/" },
  { name: "Cisco Blogs", category: "Infrastructure", url: "https://blogs.cisco.com/feed" },
  { name: "The Hacker News", category: "Security", url: "https://feeds.feedburner.com/TheHackersNews" },
  { name: "Krebs on Security", category: "Security", url: "https://krebsonsecurity.com/feed/" },
  { name: "Ars Technica", category: "Industry", url: "http://feeds.arstechnica.com/arstechnica/index" },
  { name: "TechCrunch", category: "Startups", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", category: "Industry", url: "https://www.theverge.com/rss/index.xml" },
  { name: "MIT Technology Review", category: "Research", url: "https://www.technologyreview.com/feed/" }
];

let config = loadConfig();
let scheduledTask = null;

ensureDataFiles();
scheduleDigestJob();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  const safeConfig = {
    ...config,
    smtp: {
      ...config.smtp,
      pass: config.smtp.pass ? "********" : ""
    }
  };
  res.json(safeConfig);
});

app.post("/api/config", (req, res) => {
  try {
    const incoming = req.body || {};
    const nextConfig = {
      ...defaultConfig,
      ...config,
      ...incoming,
      recipients: normalizeRecipients(incoming.recipients || []),
      digestSize: clampDigestSize(incoming.digestSize),
      smtp: {
        ...defaultConfig.smtp,
        ...config.smtp,
        ...(incoming.smtp || {})
      }
    };

    if (incoming.smtp && incoming.smtp.pass === "********") {
      nextConfig.smtp.pass = config.smtp.pass;
    }

    config = nextConfig;
    saveJson(CONFIG_PATH, config);
    scheduleDigestJob();
    res.json({ ok: true, config: { ...config, smtp: { ...config.smtp, pass: config.smtp.pass ? "********" : "" } } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/news", async (_req, res) => {
  try {
    const items = await fetchNews();
    saveJson(CACHE_PATH, { fetchedAt: new Date().toISOString(), items });
    res.json({ ok: true, fetchedAt: new Date().toISOString(), items });
  } catch (error) {
    const cached = readJson(CACHE_PATH, { fetchedAt: null, items: [] });
    res.status(200).json({
      ok: false,
      error: error.message,
      fetchedAt: cached.fetchedAt,
      items: cached.items
    });
  }
});

app.post("/api/send", async (_req, res) => {
  try {
    const result = await sendDigestEmail();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    sourceCount: newsSources.length,
    recipientsConfigured: config.recipients.length,
    smtpConfigured: Boolean(config.smtp.host && config.smtp.user && config.smtp.from),
    autoSendEnabled: config.autoSendEnabled,
    nextRun: config.autoSendEnabled ? `${config.sendTime} ${config.timezone}` : "Manual only"
  });
});

app.listen(PORT, () => {
  console.log(`IT News Daily running at http://localhost:${PORT}`);
});

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    saveJson(CONFIG_PATH, defaultConfig);
  }
  if (!fs.existsSync(CACHE_PATH)) {
    saveJson(CACHE_PATH, { fetchedAt: null, items: [] });
  }
}

function loadConfig() {
  return readJson(CONFIG_PATH, defaultConfig);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeRecipients(recipients) {
  return Array.from(
    new Set(
      recipients
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    )
  );
}

function clampDigestSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return defaultConfig.digestSize;
  }
  return Math.min(50, Math.max(5, Math.round(number)));
}

async function fetchNews() {
  const feeds = await Promise.allSettled(newsSources.map((source) => parser.parseURL(source.url)));
  const items = [];

  feeds.forEach((result, index) => {
    const source = newsSources[index];
    if (result.status !== "fulfilled") {
      return;
    }

    for (const item of result.value.items || []) {
      const url = item.link || item.guid;
      if (!url || !item.title) {
        continue;
      }

      items.push({
        title: cleanText(item.title),
        url,
        source: source.name,
        category: source.category,
        summary: cleanText(item.contentSnippet || item.summary || ""),
        publishedAt: normalizeDate(item.isoDate || item.pubDate)
      });
    }
  });

  const deduped = [];
  const seen = new Set();

  for (const item of items.sort(sortByDateDesc)) {
    const key = `${item.title.toLowerCase()}|${item.url.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped.slice(0, config.digestSize);
}

function sortByDateDesc(a, b) {
  return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
}

function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function sendDigestEmail() {
  validateEmailSetup();

  const items = await fetchNews();
  saveJson(CACHE_PATH, { fetchedAt: new Date().toISOString(), items });

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: Number(config.smtp.port),
    secure: Boolean(config.smtp.secure),
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass
    }
  });

  const today = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeZone: config.timezone || "UTC"
  }).format(new Date());

  const subject = `${config.appTitle} Digest - ${today}`;
  const html = buildEmailHtml(items, today);
  const text = buildEmailText(items, today);

  const info = await transporter.sendMail({
    from: config.smtp.from,
    to: config.recipients.join(", "),
    subject,
    html,
    text
  });

  return {
    messageId: info.messageId,
    recipientCount: config.recipients.length,
    itemCount: items.length
  };
}

function validateEmailSetup() {
  if (!config.recipients.length) {
    throw new Error("Add at least one recipient email address first.");
  }

  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass || !config.smtp.from) {
    throw new Error("Complete the SMTP settings before sending email.");
  }
}

function buildEmailHtml(items, today) {
  const list = items
    .map(
      (item) => `
        <li style="margin:0 0 16px 0;">
          <a href="${item.url}" style="color:#0b5fff;text-decoration:none;font-weight:700;">${escapeHtml(item.title)}</a>
          <div style="color:#44515f;font-size:13px;margin-top:4px;">${escapeHtml(item.source)} | ${escapeHtml(item.category)} | ${formatPublished(item.publishedAt)}</div>
          ${item.summary ? `<div style="color:#1f2a33;font-size:14px;margin-top:6px;">${escapeHtml(item.summary)}</div>` : ""}
        </li>
      `
    )
    .join("");

  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#f3f7fb;padding:24px;color:#102033;">
      <div style="max-width:820px;margin:0 auto;background:#ffffff;border-radius:20px;padding:28px;border:1px solid #d9e4ef;">
        <div style="margin-bottom:24px;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#4e6b88;">Daily Briefing</div>
          <h1 style="margin:8px 0 6px 0;font-size:32px;line-height:1.1;">${escapeHtml(config.appTitle)}</h1>
          <div style="color:#587089;">${escapeHtml(today)}</div>
        </div>
        <ol style="padding-left:20px;margin:0;">
          ${list}
        </ol>
      </div>
    </div>
  `;
}

function buildEmailText(items, today) {
  const lines = [
    `${config.appTitle}`,
    today,
    ""
  ];

  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   ${item.source} | ${item.category} | ${formatPublished(item.publishedAt)}`);
    if (item.summary) {
      lines.push(`   ${item.summary}`);
    }
    lines.push(`   ${item.url}`);
    lines.push("");
  });

  return lines.join("\n");
}

function formatPublished(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scheduleDigestJob() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  if (!config.autoSendEnabled) {
    return;
  }

  const [hour, minute] = String(config.sendTime || "08:00").split(":").map((value) => Number(value));
  const cronExpression = `${Number.isFinite(minute) ? minute : 0} ${Number.isFinite(hour) ? hour : 8} * * *`;

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      try {
        await sendDigestEmail();
      } catch (error) {
        console.error("Scheduled send failed:", error.message);
      }
    },
    {
      timezone: config.timezone || "UTC"
    }
  );
}
