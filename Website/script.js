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
// Safe check in case debiasToggle isn't present in the current HTML structure
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

function updateModeUI() {
  if (!modeToggle) return;
  modeToggle.querySelectorAll(".mode-btn").forEach((btn) => {
    if (btn.getAttribute("data-mode") === currentMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

if (modeToggle) {
  modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn) return;
    currentMode = btn.getAttribute("data-mode");
    localStorage.setItem("veritas_mode", currentMode);
    updateModeUI();

    // If there is already an answer on screen, re-search automatically to update mode!
    const lastQ = questionInput.value.trim();
    if (lastQ) {
      performSearch(lastQ);
    }
  });
}
updateModeUI();

// --- Theme toggle ---
const savedTheme = localStorage.getItem("veritas_theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("veritas_theme", next);
  });
}

// --- Search initiation event listeners ---
if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    const q = questionInput.value.trim();
    if (q) performSearch(q);
  });
}

if (questionInput) {
  questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = questionInput.value.trim();
      if (q) performSearch(q);
    }
  });
}

// --- Perform the search ---
async function performSearch(question) {
  clearResult();
  showLoading();

  const bodyPayload = {
    question,
    mode: currentMode,
    debias: debiasToggle ? debiasToggle.checked : true // Default to true if toggle isn't in UI
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (!data || Object.keys(data).length === 0) {
      showEmpty();
      return;
    }

    showResult(question, data);
  } catch (error) {
    console.error("Search failed:", error);
    showError();
  }
}

function clearResult() {
  resultArea.innerHTML = "";
}

function showLoading() {
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
