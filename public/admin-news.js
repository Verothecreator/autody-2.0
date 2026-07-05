const newsDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

function newsEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function newsNotice(message, state = "neutral") {
  const notice = document.getElementById("news-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.state = state;
}

function newsFormatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : newsDate.format(date);
}

function newsFormBody(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  Object.keys(body).forEach((key) => {
    body[key] = String(body[key] || "").trim();
  });
  return body;
}

function renderNewsRows(articles = []) {
  const target = document.getElementById("news-table");
  const count = document.querySelector("[data-news-count]");
  if (count) count.textContent = String(articles.length);
  if (!target) return;
  if (!articles.length) {
    target.innerHTML = `<div class="admin-empty">No admin news has been published yet.</div>`;
    return;
  }

  target.innerHTML = articles.map((article) => `
    <div class="admin-record">
      <span>
        <strong>${newsEscape(article.title || "Untitled story")}</strong>
        <small>${newsEscape(article.summary || "No summary added.")}</small>
      </span>
      <span>
        <strong>${newsEscape(article.subject || "Markets")}</strong>
        <small>${newsEscape(article.source || "Autody update")}</small>
      </span>
      <span>
        <strong>${newsFormatDate(article.publishedAt || article.capturedAt)}</strong>
        <small>Published</small>
      </span>
      <span>
        ${article.url ? `<a class="admin-copy" href="${newsEscape(article.url)}" target="_blank" rel="noreferrer">Open</a>` : `<strong>-</strong>`}
        <small>Source link</small>
      </span>
    </div>
  `).join("");
}

async function loadNewsData() {
  newsNotice("Loading news data...", "neutral");
  const data = await opsPost("/api/admin/news/overview", { limit: 100 });
  renderNewsRows(Array.isArray(data.articles) ? data.articles : []);
  const generated = data.generatedAt ? newsFormatDate(data.generatedAt) : "now";
  newsNotice(`News data loaded. Last refresh ${generated}.`, "success");
}

async function publishNews(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("[type='submit']");
  const originalText = submit?.textContent || "Publish News";
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Publishing...";
  }
  try {
    const data = await opsPost("/api/admin/news/publish", newsFormBody(form));
    renderNewsRows(Array.isArray(data.articles) ? data.articles : []);
    form.reset();
    newsNotice("News published to the platform feed.", "success");
  } catch (err) {
    newsNotice(err.message || "News publish failed.", "error");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  }
}

async function bootNewsPortal() {
  const status = document.getElementById("news-session-status");
  const session = await opsRequireSession();
  if (!session) return;
  if (status) {
    status.textContent = session.expiresAt
      ? `Active until ${newsFormatDate(session.expiresAt)}`
      : "Active session";
  }
  document.getElementById("news-refresh")?.addEventListener("click", () => {
    loadNewsData().catch((err) => newsNotice(err.message || "Refresh failed.", "error"));
  });
  document.getElementById("news-form")?.addEventListener("submit", publishNews);
  loadNewsData().catch((err) => newsNotice(err.message || "Could not load news data.", "error"));
}

bootNewsPortal();
