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
        debias: currentDebias // Forward toggle switch option
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
  const a = document.createElement("a");
  a.className = "source-item";
  a.href = s.link;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  
  const spanTitle = document.createElement("span");
  spanTitle.className = "source-title";
  spanTitle.textContent = s.title || s.link;
  a.appendChild(spanTitle);

  const spanUrl = document.createElement("span");
  spanUrl.className = "source-url";
  spanUrl.textContent = s.link;
  a.appendChild(spanUrl);

  return a;
}
