// script.js
// Talks to your Render-hosted backend's POST /ask endpoint and renders
// the result using the templates in index.html.

const API_URL = "/ask";
const MORE_SOURCES_URL = "/more-sources";
const EMERGING_RESEARCH_URL = "/emerging-research";

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

// Loading-state chrome only -- keeps things light while the request runs.
// Deliberately never used for the answer, evidence, or disagreement text.
const LOADING_LINES = [
  "consulting the trusted shelf of sources...",
  "don't panic -- checking the bedrock first...",
  "reading past the truncated bits...",
  "sorting the sediment from the bedrock...",
];

function showLoading() {
  clearResult();
  const tpl = document.getElementById("loadingTemplate");
  const node = tpl.content.cloneNode(true);
  const line = LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)];
  node.querySelector(".loading-text").textContent = line;
  resultArea.appendChild(node);
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
    } else {
      volatilityBadge.style.display = "none";
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

  const aiNoteText = node.querySelector(".ai-note-text");
  if (!isHuman && !data.directAnswer) {
    aiNoteText.textContent = "this explanation wasn't written by a person — it's generated from the sources below";
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
  } else {
    strataSection.style.display = "none";
  }

  // --- Direct answer (verbatim, tier-ranked snippet) ---
  const directAnswerBlock = node.querySelector(".direct-answer");
  if (!isHuman && data.directAnswer) {
    directAnswerBlock.style.display = "";
    node.querySelector(".direct-answer-text").textContent = data.directAnswer.text || "";

    const sourceLink = node.querySelector(".direct-answer-source");
    sourceLink.href = data.directAnswer.link || "#";
    node.querySelector(".direct-answer-source-title").textContent = data.directAnswer.title || data.directAnswer.link || "";

    const info = tierInfo(data.directAnswer.tier);
    const tierBadge = node.querySelector(".direct-answer-tier-badge");
    tierBadge.textContent = info.label;
    tierBadge.className = `direct-answer-tier-badge source-tier-badge ${info.key}`;
  } else {
    // The generic .ai-only sweep above already force-showed this element for
    // AI-tier results -- explicitly re-hide it here when there's no snippet
    // to show (e.g. extraction failed for every source).
    directAnswerBlock.style.display = "none";
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

  // --- Argument map (contested mode only) ---
  // Only rendered when the backend actually produced pillars -- for
  // genuinely settled questions there's no argumentMap at all, so this
  // section stays hidden and the plain direct-answer + context layout is
  // what the person sees. Pillar column widths are proportional to the
  // real pillar counts on each side; never forced to 50/50.
  const argMapSection = node.querySelector(".argument-map-section");
  const pillars = (data.argumentMap && data.argumentMap.pillars) || [];
  if (!isHuman && pillars.length > 0) {
    argMapSection.style.display = "";
    node.querySelector(".argument-map-core").textContent = data.argumentMap.coreClaim || question;

    const supportingCol = node.querySelector(".argument-map-column.supporting");
    const skepticalCol = node.querySelector(".argument-map-column.skeptical");
    const supportingList = supportingCol.querySelector(".argument-map-pillars");
    const skepticalList = skepticalCol.querySelector(".argument-map-pillars");

    const supporting = pillars.filter((p) => p.stance === "supporting");
    const skeptical = pillars.filter((p) => p.stance === "skeptical");

    // Flex-grow proportional to pillar count on each side, with a floor so
    // a lone dissenting pillar still gets a visible sliver rather than
    // vanishing -- but a 5-vs-0 split still reads as overwhelmingly lopsided,
    // which is the point: the map should look like the evidence, not like a
    // debate stage.
    const total = supporting.length + skeptical.length || 1;
    supportingCol.style.flexGrow = Math.max(supporting.length / total, 0.12);
    skepticalCol.style.flexGrow = Math.max(skeptical.length / total, 0.12);
    skepticalCol.style.display = skeptical.length > 0 ? "" : "none";
    supportingCol.style.flexGrow = skeptical.length > 0 ? supportingCol.style.flexGrow : 1;

    const buildPillar = (p) => {
      const el = document.createElement("button");
      const info = tierInfo(Number(p.tier));
      el.type = "button";
      el.className = `argument-pillar ${info.key}`;
      el.innerHTML = `<span class="argument-pillar-claim">${p.claim || ""}</span>`;
      el.addEventListener("click", () => {
        el.classList.toggle("expanded");
      });
      const detail = document.createElement("span");
      detail.className = "argument-pillar-institution";
      detail.textContent = p.institution || "";
      el.appendChild(detail);
      return el;
    };

    supporting.forEach((p) => supportingList.appendChild(buildPillar(p)));
    skeptical.forEach((p) => skepticalList.appendChild(buildPillar(p)));
  } else {
    argMapSection.style.display = "none";
  }

  // AI tier: the model writes "context" now, not the primary answer.
  // Human tier keeps its own hand-written "answer" field, untouched.
  const contextLabel = node.querySelector(".context-label");
  if (isHuman) {
    node.querySelector(".answer-text").textContent = data.answer || "";
  } else {
    node.querySelector(".answer-text").textContent = data.context || "";
    // Only caption this as "background" when there's a direct-answer snippet
    // above it -- otherwise this text IS the answer, not background to one.
    contextLabel.style.display = data.directAnswer ? "" : "none";
    // When an argument map is already shown above, the prose below it is
    // the fuller writeup, not a first introduction to the topic.
    contextLabel.textContent = pillars.length > 0 ? "the fuller writeup" : "background & context";
  }

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
  } else {
    evidenceBtn.style.display = "none";
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

  // --- Emerging Research (lazy-loaded Tier 2 preprints, real citation signals) ---
  const emergingBtn = node.querySelector(".emerging-research-btn");
  const emergingSection = node.querySelector(".emerging-research-section");
  const emergingList = node.querySelector(".emerging-research-list");
  if (!isHuman) {
    emergingBtn.style.display = "";
    emergingBtn.addEventListener("click", async () => {
      const opening = emergingSection.style.display === "none";
      if (!opening) {
        emergingSection.style.display = "none";
        emergingBtn.querySelector("span").textContent = "peek at the emerging research ↓";
        return;
      }
      if (emergingList.childElementCount > 0) {
        emergingSection.style.display = "";
        emergingBtn.querySelector("span").textContent = "hide emerging research ↑";
        return;
      }

      emergingBtn.disabled = true;
      emergingBtn.querySelector("span").textContent = "scouting the preprint servers...";

      try {
        const res = await fetch(EMERGING_RESEARCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        const payload = await res.json();
        const results = payload.results || [];

        if (results.length === 0) {
          const empty = document.createElement("div");
          empty.className = "emerging-research-empty";
          empty.textContent = "Nothing new and citable turned up for this one -- the trail's gone cold, for now.";
          emergingList.appendChild(empty);
        } else {
          results.forEach((r) => emergingList.appendChild(buildEmergingResearchItem(r)));
        }

        emergingSection.style.display = "";
        emergingBtn.querySelector("span").textContent = "hide emerging research ↑";
      } catch (err) {
        console.error(err);
        emergingBtn.querySelector("span").textContent = "couldn't reach the preprint servers -- try again";
      } finally {
        emergingBtn.disabled = false;
      }
    });
  } else {
    emergingBtn.style.display = "none";
  }

  const listenBtn = node.querySelector(".listen-btn");
  const listenLabel = node.querySelector(".listen-label");
  listenBtn.addEventListener("click", () => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      listenLabel.textContent = "listen";
      return;
    }
    const spoken = isHuman
      ? (data.answer || "")
      : [data.directAnswer ? data.directAnswer.text : "", data.context || ""].filter(Boolean).join(". ");
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.rate = 0.95;
    utterance.onend = () => {
      listenLabel.textContent = "listen";
    };
    listenLabel.textContent = "stop";
    window.speechSynthesis.speak(utterance);
  });

  resultArea.appendChild(node);
}

function buildEmergingResearchItem(r) {
  const a = document.createElement("a");
  a.className = "emerging-research-item";
  a.href = r.link || "#";
  a.target = "_blank";
  a.rel = "noopener noreferrer";

  const topRow = document.createElement("div");
  topRow.className = "emerging-research-top-row";

  const title = document.createElement("span");
  title.className = "emerging-research-title";
  title.textContent = r.title || r.link;
  topRow.appendChild(title);
  a.appendChild(topRow);

  const meta = document.createElement("span");
  meta.className = "emerging-research-meta";
  const bits = [];
  if (r.venue) bits.push(r.venue);
  if (r.year) bits.push(String(r.year));
  bits.push(
    r.citationVelocity !== null && r.citationVelocity !== undefined
      ? `${r.citationVelocity} citations/yr`
      : "too new to rank yet"
  );
  meta.textContent = bits.join(" · ");
  a.appendChild(meta);

  if (r.summary) {
    const summary = document.createElement("span");
    summary.className = "emerging-research-summary";
    summary.textContent = r.summary;
    a.appendChild(summary);
  }

  return a;
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

  // Real text-node space, not just CSS flex gap -- gap doesn't produce an
  // actual space character, so copy/pasting the rendered text can otherwise
  // paste the badge and title jammed together with no separator.
  topRow.appendChild(document.createTextNode(" "));

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
