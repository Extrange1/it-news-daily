const form = document.getElementById("config-form");
const saveState = document.getElementById("save-state");
const newsList = document.getElementById("news-list");
const newsFetchedAt = document.getElementById("news-fetched-at");
const refreshButton = document.getElementById("refresh-news");
const sendNowButton = document.getElementById("send-now");
const template = document.getElementById("news-item-template");

const fields = {
  appTitle: document.getElementById("appTitle"),
  digestSize: document.getElementById("digestSize"),
  recipients: document.getElementById("recipients"),
  sendTime: document.getElementById("sendTime"),
  timezone: document.getElementById("timezone"),
  autoSendEnabled: document.getElementById("autoSendEnabled"),
  smtpHost: document.getElementById("smtpHost"),
  smtpPort: document.getElementById("smtpPort"),
  smtpUser: document.getElementById("smtpUser"),
  smtpPass: document.getElementById("smtpPass"),
  smtpFrom: document.getElementById("smtpFrom"),
  smtpSecure: document.getElementById("smtpSecure")
};

init().catch(showError);

async function init() {
  await Promise.all([loadConfig(), loadStatus(), loadNews()]);
  form.addEventListener("submit", saveConfig);
  refreshButton.addEventListener("click", loadNews);
  sendNowButton.addEventListener("click", sendNow);
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();

  fields.appTitle.value = config.appTitle || "";
  fields.digestSize.value = config.digestSize || 25;
  fields.recipients.value = (config.recipients || []).join(", ");
  fields.sendTime.value = config.sendTime || "08:00";
  fields.timezone.value = config.timezone || "Europe/Lisbon";
  fields.autoSendEnabled.checked = Boolean(config.autoSendEnabled);
  fields.smtpHost.value = config.smtp.host || "";
  fields.smtpPort.value = config.smtp.port || 587;
  fields.smtpUser.value = config.smtp.user || "";
  fields.smtpPass.value = config.smtp.pass || "";
  fields.smtpFrom.value = config.smtp.from || "";
  fields.smtpSecure.checked = Boolean(config.smtp.secure);
}

async function loadStatus() {
  const response = await fetch("/api/status");
  const status = await response.json();

  document.getElementById("status-sources").textContent = status.sourceCount;
  document.getElementById("status-recipients").textContent = status.recipientsConfigured;
  document.getElementById("status-smtp").textContent = status.smtpConfigured ? "Ready" : "Pending";
  document.getElementById("status-schedule").textContent = status.nextRun;
}

async function loadNews() {
  setBusy(refreshButton, true, "Refreshing...");

  try {
    const response = await fetch("/api/news");
    const payload = await response.json();

    renderNews(payload.items || []);
    newsFetchedAt.textContent = payload.fetchedAt
      ? `Updated ${new Date(payload.fetchedAt).toLocaleString()}`
      : "Using cached data";

    if (!payload.ok && payload.error) {
      saveState.textContent = `Using cache: ${payload.error}`;
    } else {
      saveState.textContent = "News refreshed";
    }
  } finally {
    setBusy(refreshButton, false, "Refresh news");
  }
}

function renderNews(items) {
  newsList.innerHTML = "";

  if (!items.length) {
    newsList.innerHTML = `<div class="news-item"><strong>No stories available.</strong><p class="news-summary">Try refreshing after saving your settings.</p></div>`;
    return;
  }

  for (const item of items) {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector(".news-source").textContent = item.source;
    fragment.querySelector(".news-category").textContent = item.category;
    fragment.querySelector(".news-date").textContent = new Date(item.publishedAt).toLocaleString();
    const link = fragment.querySelector(".news-title");
    link.textContent = item.title;
    link.href = item.url;
    fragment.querySelector(".news-summary").textContent = item.summary || "No summary available.";
    newsList.appendChild(fragment);
  }
}

async function saveConfig(event) {
  event.preventDefault();
  saveState.textContent = "Saving...";

  const body = {
    appTitle: fields.appTitle.value.trim(),
    digestSize: Number(fields.digestSize.value),
    recipients: fields.recipients.value.split(",").map((entry) => entry.trim()).filter(Boolean),
    sendTime: fields.sendTime.value,
    timezone: fields.timezone.value.trim(),
    autoSendEnabled: fields.autoSendEnabled.checked,
    smtp: {
      host: fields.smtpHost.value.trim(),
      port: Number(fields.smtpPort.value),
      user: fields.smtpUser.value.trim(),
      pass: fields.smtpPass.value,
      from: fields.smtpFrom.value.trim(),
      secure: fields.smtpSecure.checked
    }
  };

  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "Could not save settings.");
  }

  saveState.textContent = "Settings saved";
  await loadStatus();
}

async function sendNow() {
  setBusy(sendNowButton, true, "Sending...");
  saveState.textContent = "Sending digest...";

  try {
    const response = await fetch("/api/send", { method: "POST" });
    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.error || "Could not send email.");
    }
    saveState.textContent = `Sent ${payload.itemCount} stories to ${payload.recipientCount} recipient(s)`;
  } finally {
    setBusy(sendNowButton, false, "Send today's email");
  }
}

function setBusy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = label;
}

function showError(error) {
  console.error(error);
  saveState.textContent = error.message;
}
