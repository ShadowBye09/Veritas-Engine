// script.js
// Talks to your Render-hosted backend's POST /ask endpoint and renders
// the result using the templates in index.html.

const API_URL = "https://veritas-engine-8jlh.onrender.com/ask";
const MORE_SOURCES_URL = "https://veritas-engine-8jlh.onrender.com/more-sources";

const questionInput = document.getElementById("questionInput");
const searchBtn = document.getElementById("searchBtn");
const resultArea = document.getElementById("resultArea");
const modeToggle = document.getElementById("modeToggle");
const themeToggle = document.getElementById("themeToggle");
const debiasToggle = document.getElementById("debiasToggle");

// Tier metadata for rendering -- mirrors the trust tiers defined in the
// backend's config.js (1 = bedrock/most trusted ... 3 = surface/commentary).
const TIER_META = {
  1: { key: "tier1", label: "Bedrock" },
  2: { key: "tier2", label: "Sediment" },
  3: { key: "tier3", label: "Surface" },
};

function tierInfo(tier) {
  return TIER_META[tier] || { key: "unranked", label: "Unranked" };
}

const VOLATILITY_LABELS = {
  FAST: "fast-moving topic",
  MEDIUM: "stable topic",
  SLOW: "rarely changes",
};

// --- Persistent kid/adult mode ---
let currentMode = localStorage.getItem("veritas_mode") || "kid";

function applyModeUI() {
  modeToggle.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });
}
applyModeUI();

modeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  currentMode = btn.dataset.mode;
  localStorage.setItem("veritas_mode", currentMode);
  applyModeUI();
});

// --- Persistent dark mode ---
let currentTheme = localStorage.getItem("veritas_theme") || "light";

function applyThemeUI() {
  document.documentElement.setAttribute("data-theme", currentTheme);
}
applyThemeUI();

themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  localStorage.setItem("veritas_theme", currentTheme);
  applyThemeUI();
});

// --- Persistent de-bias engine selection ---
let currentDebias = localStorage.getItem("veritas_debias") === "true";
debiasToggle.checked = currentDebias;

debiasToggle.addEventListener("change", () => {
  currentDebias = debiasToggle.checked;
  localStorage.setItem("veritas_debias", currentDebias);
});

// --- Search handling ---
searchBtn.addEventListener("click", runSearch);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

async function runSearch() {
  const question = questionInput.value.trim();
  if (!question) return;

  window.speechSynthesis.cancel();
  showLoading();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        mode: currentMode,
        debias: currentDebias
      }),
    });

    if (!res.ok) {
      showError();
      return;
    }

    const data = await res.json();

    if (!data.sources || data.sources.length === 0) {
      showEmpty();
      return;
    }

    showResult(question, data);
  } catch (err) {
    console.error(err);
    showError();
  }
}

function clearResult() {
  window.speechSynthesis.cancel();
  resultArea.innerHTML = "";
}

function showLoading() {
  clearResult();
  const tpl = document.getElementById("loadingTemplate");
  resultArea.appendChild(tpl.content.cloneNode(true));
}

function showError() {
  clearResult();
  const tpl = document.getElementById("errorTemplate");
  resultArea.appendChild(tpl.content.cloneNode(true));
}

function showEmpty() {
  clearResult();
  const tpl = document.getElementById("emptyTemplate");
  resultArea.appendChild(tpl.content.cloneNode(true));
}

function showResult(question, data) {
  clearResult();
  const tpl = document.getElementById("resultTemplate");
  const node = tpl.content.cloneNode(true);

  const isHuman = data.tier === "human";

  node.querySelectorAll(".ai-only").forEach((el) => {
    el.style.display = isHuman ? "none" : "";
  });
  node.querySelectorAll(".human-only").forEach((el) => {
    el.style.display = isHuman ? "" : "none";
  });

  node.querySelector(".question-title").textContent = question;

  // --- Freshness + volatility badges (AI tier only) ---
  const freshnessBadge = node.querySelector(".freshness-badge");
  const volatilityBadge = node.querySelector(".volatility-badge");
  if (!isHuman) {
    freshnessBadge.style.display = "";
    freshnessBadge.textContent = data.cached ? "from shared cache" : "freshly checked";

    if (data.volatility) {
      volatilityBadge.style.display = "";
      volatilityBadge.textContent = VOLATILITY_LABELS[data.volatility] || data.volatility.toLowerCase();
    }
  }

  // --- Byline (human tier) ---
  const byline = node.querySelector(".byline");
  if (isHuman) {
    const parts = [];
    if (data.author) parts.push(`written by ${data.author}`);
    if (data.reviewedBy) parts.push(`reviewed by ${data.reviewedBy}`);
    if (data.lastUpdated) parts.push(`updated ${data.lastUpdated}`);
    if (parts.length) {
      byline.style.display = "";
      byline.textContent = parts.join(" · ");
    }
  }

  // --- Evidence strata bar (AI tier only) ---
  const strataSection = node.querySelector(".strata-section");
  if (!isHuman && (data.sources || []).length > 0) {
    const counts = { tier1: 0, tier2: 0, tier3: 0, unranked: 0 };
    data.sources.forEach((s) => {
      const info = tierInfo(s.tier);
      counts[info.key] += 1;
    });

    const total = data.sources.length;
    const bar = node.querySelector(".strata-bar");
    const caption = node.querySelector(".strata-caption");

    ["tier1", "tier2", "tier3", "unranked"].forEach((key) => {
      if (counts[key] === 0) return;
      const seg = document.createElement("div");
      seg.className = `strata-segment ${key}`;
      seg.style.width = `${(counts[key] / total) * 100}%`;
      bar.appendChild(seg);

      const label = key === "unranked" ? "unranked" : tierInfo(Object.keys(TIER_META).find(k => TIER_META[k].key === key)).label.toLowerCase();
      const item = document.createElement("span");
      item.className = "strata-caption-item";
      item.innerHTML = `<span class="strata-dot ${key}"></span>${counts[key]} ${label}`;
      caption.appendChild(item);
    });

    strataSection.style.display = "";
  }

  // --- Strategy banner ---
  const strategyBanner = node.querySelector(".strategy-banner");
  if (data.searchStrategy && data.searchStrategy.isContested) {
    strategyBanner.style.display = "block";
    node.querySelector(".query-a-text").textContent = data.searchStrategy.queryA || "";
    node.querySelector(".query-b-text").textContent = data.searchStrategy.queryB || "";
  } else if (strategyBanner) {
    strategyBanner.style.display = "none";
  }

  node.querySelector(".answer-text").textContent = data.answer || "";
  node.querySelector(".disagreement-text").textContent =
    data.disagreement || "No disagreement information available.";
  node.querySelector(".confidence-value").textContent = data.confidence || "unknown";

  // --- Evidence trail (the model's own extraction scratchpad, made visible) ---
  const evidenceBtn = node.querySelector(".evidence-trail-btn");
  const evidenceList = node.querySelector(".evidence-trail-list");
  if (!isHuman && (data.evidenceNotes || []).length > 0) {
    evidenceBtn.style.display = "";
    data.evidenceNotes.forEach((note) => {
      const source = (data.sources || []).find((s) => String(s.index) === String(note.marker));
      const tier = source ? source.tier : null;
      const info = tierInfo(tier);

      const item = document.createElement("div");
      item.className = `evidence-note ${info.key}`;
      item.innerHTML = `<span class="evidence-note-marker">[${note.marker}]</span>${note.claim || ""}`;
      evidenceList.appendChild(item);
    });

    evidenceBtn.addEventListener("click", () => {
      const opening = !evidenceBtn.classList.contains("open");
      evidenceBtn.classList.toggle("open", opening);
      evidenceList.classList.toggle("open", opening);
    });
  }

  // --- Sources ---
  const sourcesList = node.querySelector(".sources-list");
  (data.sources || []).forEach((s) => {
    sourcesList.appendChild(buildSourceLink(s));
  });

  const readMoreBtn = node.querySelector(".read-more-btn");
  const moreSourcesList = node.querySelector(".more-sources-list");

  if (isHuman) {
    readMoreBtn.style.display = "";
    readMoreBtn.textContent = "read more from verified sources ↓";
    readMoreBtn.addEventListener("click", async () => {
      const opening = moreSourcesList.style.display === "none";
      if (!opening) {
        moreSourcesList.style.display = "none";
        readMoreBtn.textContent = "read more from verified sources ↓";
        return;
      }

      if (moreSourcesList.childElementCount > 0) {
        moreSourcesList.style.display = "flex";
        readMoreBtn.textContent = "hide extra sources ↑";
        return;
      }

      readMoreBtn.disabled = true;
      readMoreBtn.textContent = "searching verified sources...";

      try {
        const excludeLinks = (data.sources || []).map((s) => s.link);
        const res = await fetch(MORE_SOURCES_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, excludeLinks }),
        });
        const extra = await res.json();
        const moreSources = extra.moreSources || [];

        moreSources.forEach((s) => {
          const item = buildSourceLink(s);
          if (s.snippet) {
            const snippet = document.createElement("span");
            snippet.className = "source-snippet";
            snippet.textContent = s.snippet;
            item.appendChild(snippet);
          }
          moreSourcesList.appendChild(item);
        });

        moreSourcesList.style.display = "flex";
        readMoreBtn.textContent = moreSources.length
          ? "hide extra sources ↑"
          : "no additional sources found";
      } catch (err) {
        console.error(err);
        readMoreBtn.textContent = "couldn't load more sources -- try again";
      } finally {
        readMoreBtn.disabled = false;
      }
    });
  } else if ((data.moreSources || []).length > 0) {
    const moreSources = data.moreSources;
    readMoreBtn.style.display = "";
    readMoreBtn.textContent = `read more from verified sources (${moreSources.length}) ↓`;
    readMoreBtn.addEventListener("click", () => {
      const opening = moreSourcesList.style.display === "none";
      moreSourcesList.style.display = opening ? "flex" : "none";
      readMoreBtn.textContent = opening
        ? "hide extra sources ↑"
        : `read more from verified sources (${moreSources.length}) ↓`;

      if (opening && moreSourcesList.childElementCount === 0) {
        moreSources.forEach((s) => {
          const item = buildSourceLink(s);
          if (s.snippet) {
            const snippet = document.createElement("span");
            snippet.className = "source-snippet";
            snippet.textContent = s.snippet;
            item.appendChild(snippet);
          }
          moreSourcesList.appendChild(item);
        });
      }
    });
  }

  const listenBtn = node.querySelector(".listen-btn");
  const listenLabel = node.querySelector(".listen-label");
  listenBtn.addEventListener("click", () => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      listenLabel.textContent = "listen";
      return;
    }
    const utterance = new SpeechSynthesisUtterance(data.answer || "");
    utterance.rate = 0.95;
    utterance.onend = () => {
      listenLabel.textContent = "listen";
    };
    listenLabel.textContent = "stop";
    window.speechSynthesis.speak(utterance);
  });

  resultArea.appendChild(node);
}

function buildSourceLink(s) {
  const info = tierInfo(s.tier);

  const a = document.createElement("a");
  a.className = `source-item ${info.key}`;
  a.href = s.link;
  a.target = "_blank";
  a.rel = "noopener noreferrer";

  const topRow = document.createElement("div");
  topRow.className = "source-top-row";

  const badge = document.createElement("span");
  badge.className = `source-tier-badge ${info.key}`;
  badge.textContent = info.label;
  topRow.appendChild(badge);

  const spanTitle = document.createElement("span");
  spanTitle.className = "source-title";
  spanTitle.textContent = s.title || s.link;
  topRow.appendChild(spanTitle);

  a.appendChild(topRow);

  const spanUrl = document.createElement("span");
  spanUrl.className = "source-url";
  spanUrl.textContent = s.link;
  a.appendChild(spanUrl);

  return a;
}
