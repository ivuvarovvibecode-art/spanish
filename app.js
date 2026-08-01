/* =========================================================
   Español SRS — простий особистий тренажер з інтервальним
   повторенням (спрощений алгоритм SM-2, як в Anki).

   Дані зберігаються в localStorage браузера — тобто прямо
   на твоєму пристрої, офлайн, без жодного сервера.
   ========================================================= */

const STORAGE_KEY = "espanol_srs_cards_v1";
const DECKS_KEY = "espanol_srs_decks_v1";
const META_KEY = "espanol_srs_meta_v1";

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function makeCard(front, back, example, deckId) {
  return {
    id: crypto.randomUUID(),
    deckId,
    front,
    back,
    example: example || "",
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    dueDate: todayStr(0),
    createdAt: Date.now(),
  };
}

function makeDeck(name) {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
  };
}

// Розбирає текст масового імпорту у список карток.
// Формат рядка: "іспанською | переклад | приклад (необов'язково)"
function parseBulkText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const parsed = [];
  let skipped = 0;

  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    const front = parts[0] || "";
    const back = parts[1] || "";
    const example = parts[2] || "";

    if (!front || !back) {
      skipped += 1;
      continue;
    }
    parsed.push({ front, back, example });
  }

  return { parsed, skipped };
}

// ---------- Зберігання: колоди ----------
// Жодних дефолтних колод — застосунок стартує повністю порожнім,
// користувач сам створює свої колоди.
function loadDecks() {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (!raw) throw new Error("no decks yet");
    return JSON.parse(raw);
  } catch (e) {
    saveDecks([]);
    return [];
  }
}

function saveDecks(decks) {
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
}

// ---------- Зберігання: картки ----------
function loadCards() {
  let loaded;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no data yet");
    loaded = JSON.parse(raw);
  } catch (e) {
    saveCards([]);
    return [];
  }

  // Міграція: якщо картки збережені ще до появи колод (немає deckId),
  // прив'язуємо їх до першої наявної колоди (або створюємо запасну),
  // щоб нічого не загубилось.
  const needsMigration = loaded.some((c) => !c.deckId);
  if (needsMigration) {
    let decks = loadDecks();
    if (decks.length === 0) {
      const fallback = makeDeck("Імпортовані картки");
      decks = [fallback];
      saveDecks(decks);
    }
    const fallbackDeckId = decks[0].id;
    loaded = loaded.map((c) => (c.deckId ? c : { ...c, deckId: fallbackDeckId }));
    saveCards(loaded);
  }

  return loaded;
}

function saveCards(cards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) throw new Error("no meta yet");
    return JSON.parse(raw);
  } catch (e) {
    const meta = { streak: 0, lastStudyDate: null };
    saveMeta(meta);
    return meta;
  }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// ---------- Експорт / імпорт (перенесення між пристроями) ----------
function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    decks,
    cards,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `espanol-srs-backup-${todayStr(0)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
      if (!Array.isArray(data.decks) || !Array.isArray(data.cards)) {
        throw new Error("bad format");
      }
    } catch (err) {
      alert("Не вдалося прочитати файл. Перевір, що це саме файл резервної копії Español SRS (.json).");
      return;
    }

    // Додаємо тільки те, чого ще немає (за id) — щоб не задвоїти прогрес,
    // якщо той самий файл імпортується повторно.
    const existingDeckIds = new Set(decks.map((d) => d.id));
    const newDecks = data.decks.filter((d) => !existingDeckIds.has(d.id));
    decks = decks.concat(newDecks);

    const existingCardIds = new Set(cards.map((c) => c.id));
    const newCards = data.cards.filter((c) => !existingCardIds.has(c.id));
    cards = cards.concat(newCards);

    saveDecks(decks);
    saveCards(cards);
    render();
    alert(`Імпортовано ${newDecks.length} нових колод і ${newCards.length} нових карток.`);
  };
  reader.readAsText(file);
}

function bumpStreak() {
  const meta = loadMeta();
  const today = todayStr(0);
  const yesterday = todayStr(-1);
  if (meta.lastStudyDate === today) {
    // вже рахували сьогодні
  } else if (meta.lastStudyDate === yesterday) {
    meta.streak += 1;
    meta.lastStudyDate = today;
  } else {
    meta.streak = 1;
    meta.lastStudyDate = today;
  }
  saveMeta(meta);
}

// ---------- Алгоритм SM-2 (спрощений) ----------
// rating: "again" | "hard" | "good" | "easy"
function schedule(card, rating) {
  let { easeFactor, interval, repetitions } = card;

  if (rating === "again") {
    repetitions = 0;
    interval = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  } else {
    repetitions += 1;
    if (rating === "hard") {
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      interval = repetitions === 1 ? 1 : Math.round(interval * 1.2) || 1;
    } else if (rating === "good") {
      if (repetitions === 1) interval = 1;
      else if (repetitions === 2) interval = 6;
      else interval = Math.round(interval * easeFactor);
    } else if (rating === "easy") {
      easeFactor = easeFactor + 0.15;
      if (repetitions === 1) interval = 4;
      else interval = Math.round(interval * easeFactor * 1.3);
    }
  }

  return {
    ...card,
    easeFactor,
    interval,
    repetitions,
    dueDate: todayStr(interval),
  };
}

function previewInterval(card, rating) {
  const next = schedule(card, rating);
  const days = next.interval;
  if (days < 1) return "сьогодні";
  if (days === 1) return "1 д";
  if (days < 30) return `${days} д`;
  return `${Math.round(days / 30)} міс`;
}

// ---------- Стан застосунку ----------
let decks = loadDecks();
let cards = loadCards();
let currentTab = "study";

// studyView: { mode: "gallery" } — вибір колоди для навчання
//         або { mode: "session", deckId } — сама сесія навчання
let studyView = { mode: "gallery" };
let studyQueue = [];
let studyDirections = {}; // { cardId: "es-uk" | "uk-es" } — напрямок питання для цієї сесії
let currentCardIndex = 0;
let isFlipped = false;

let manageView = { mode: "list" }; // { mode: "list" } або { mode: "detail", deckId }
let addSubTab = "single"; // "single" або "bulk" — режим форми додавання карток

function cardsInScope(scopeId) {
  return scopeId === "all" ? cards : cards.filter((c) => c.deckId === scopeId);
}

function dueCards(scopeId) {
  const today = todayStr(0);
  return cardsInScope(scopeId).filter((c) => c.dueDate <= today);
}

function shuffleArray(arr) {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function refreshQueueIfNeeded(deckId) {
  if (studyQueue.length === 0) {
    studyQueue = shuffleArray(dueCards(deckId).map((c) => c.id));
    currentCardIndex = 0;
    studyDirections = {};
    studyQueue.forEach((id) => {
      // Періодично питаємо у зворотному напрямку (українською → іспанською),
      // щоб не завчити просто порядок карток, а справді пригадувати слово.
      studyDirections[id] = Math.random() < 0.5 ? "es-uk" : "uk-es";
    });
  }
}

// ---------- Рендер ----------
const app = document.getElementById("app");

function render() {
  let scopeId = "all";
  if (currentTab === "study" && studyView.mode === "session") scopeId = studyView.deckId;
  if (currentTab === "manage" && manageView.mode === "detail") scopeId = manageView.deckId;

  const due = dueCards(scopeId);
  const scopedCards = cardsInScope(scopeId);
  const mastered = scopedCards.filter((c) => c.interval >= 21).length;
  const meta = loadMeta();

  app.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">Español <span>SRS</span></h1>
      <div class="streak">🔥 <strong>${meta.streak}</strong> днів поспіль</div>
    </header>

    <div class="install-banner" id="installBanner">
      <span>Встанови застосунок на пристрій</span>
      <button id="installBtn">Встановити</button>
    </div>

    <nav class="tabs">
      <button class="tab-btn ${currentTab === "study" ? "active" : ""}" data-tab="study">Навчання</button>
      <button class="tab-btn ${currentTab === "manage" ? "active" : ""}" data-tab="manage">Колоди</button>
    </nav>

    <section class="stats-row">
      <div class="stat-card"><span class="stat-value">${due.length}</span><span class="stat-label">На сьогодні</span></div>
      <div class="stat-card"><span class="stat-value">${scopedCards.length}</span><span class="stat-label">Всього карток</span></div>
      <div class="stat-card"><span class="stat-value">${mastered}</span><span class="stat-label">Вивчено</span></div>
    </section>

    <div id="tabContent"></div>
  `;

  if (currentTab === "study") renderStudy();
  else renderManage();

  bindGlobalEvents();
}

function renderStudy() {
  const container = document.getElementById("tabContent");
  if (studyView.mode === "gallery") {
    renderStudyGallery(container);
  } else {
    renderStudySession(container, studyView.deckId);
  }
}

function renderStudyGallery(container) {
  const today = todayStr(0);

  if (decks.length === 0) {
    container.innerHTML = `
      <div class="study-empty">
        <span class="big-emoji">📚</span>
        <h2>Ще немає жодної колоди</h2>
        <p>Перейди у вкладку «Колоди», щоб створити першу — а потім повертайся сюди навчатись.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <p class="gallery-title">Обери колоду для навчання</p>
    <div class="deck-gallery">
      ${decks
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((d) => {
          const deckCards = cards.filter((c) => c.deckId === d.id);
          const deckDue = deckCards.filter((c) => c.dueDate <= today).length;
          return `
          <button class="gallery-tile" data-id="${d.id}">
            <span class="gallery-tile-name">${escapeHtml(d.name)}</span>
            <span class="gallery-tile-meta">${deckCards.length} карток</span>
            ${
              deckDue > 0
                ? `<span class="gallery-tile-badge">${deckDue} на сьогодні</span>`
                : `<span class="gallery-tile-badge gallery-tile-badge-done">Все повторено</span>`
            }
          </button>`;
        })
        .join("")}
    </div>
  `;

  container.querySelectorAll(".gallery-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      studyView = { mode: "session", deckId: btn.dataset.id };
      studyQueue = [];
      studyDirections = {};
      currentCardIndex = 0;
      isFlipped = false;
      render();
    });
  });
}

function renderStudySession(container, deckId) {
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) {
    studyView = { mode: "gallery" };
    renderStudy();
    return;
  }

  refreshQueueIfNeeded(deckId);

  const backButtonHtml = `<button class="back-btn" id="backToGalleryBtn">← До колод</button>`;

  if (studyQueue.length === 0) {
    container.innerHTML = `
      ${backButtonHtml}
      <div class="study-empty">
        <span class="big-emoji">✅</span>
        <h2>«${escapeHtml(deck.name)}» — все повторено!</h2>
        <p>Повертайся завтра — або додай нові слова у вкладці «Колоди».</p>
      </div>
    `;
    bindBackToGallery();
    return;
  }

  const cardId = studyQueue[currentCardIndex];
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    studyQueue.splice(currentCardIndex, 1);
    renderStudySession(container, deckId);
    return;
  }

  const direction = studyDirections[card.id] || "es-uk";
  const isReversed = direction === "uk-es";
  const frontText = isReversed ? card.back : card.front;
  const backText = isReversed ? card.front : card.back;
  const frontHint = isReversed ? "Згадай іспанською і натисни" : "Натисни, щоб перевернути";
  const directionBadge = isReversed ? "УКР → ІСП" : "ІСП → УКР";

  container.innerHTML = `
    ${backButtonHtml}
    <p class="session-deck-name">${escapeHtml(deck.name)}</p>

    <div class="card-stage">
      <div class="flip-card ${isFlipped ? "flipped" : ""}" id="flipCard">
        <div class="card-face card-front">
          <span class="direction-badge">${directionBadge}</span>
          <span class="card-word">${escapeHtml(frontText)}</span>
          <span class="card-hint">${frontHint}</span>
        </div>
        <div class="card-face card-back">
          <span class="card-translation">${escapeHtml(backText)}</span>
          ${card.example ? `<span class="card-example">${escapeHtml(card.example)}</span>` : ""}
        </div>
      </div>
    </div>

    ${
      isFlipped
        ? `<div class="rate-row">
            <button class="rate-btn rate-again" data-rating="again">Знову<small>${previewInterval(card, "again")}</small></button>
            <button class="rate-btn rate-hard" data-rating="hard">Важко<small>${previewInterval(card, "hard")}</small></button>
            <button class="rate-btn rate-good" data-rating="good">Добре<small>${previewInterval(card, "good")}</small></button>
            <button class="rate-btn rate-easy" data-rating="easy">Легко<small>${previewInterval(card, "easy")}</small></button>
          </div>`
        : `<p class="tap-hint">${studyQueue.length} карток лишилось у цій сесії</p>`
    }
  `;

  bindBackToGallery();

  document.getElementById("flipCard").addEventListener("click", () => {
    isFlipped = !isFlipped;
    renderStudySession(document.getElementById("tabContent"), deckId);
  });

  if (isFlipped) {
    container.querySelectorAll(".rate-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const rating = btn.dataset.rating;
        const idx = cards.findIndex((c) => c.id === card.id);
        cards[idx] = schedule(card, rating);
        saveCards(cards);
        bumpStreak();

        studyQueue.splice(currentCardIndex, 1);
        if (currentCardIndex >= studyQueue.length) currentCardIndex = 0;
        isFlipped = false;
        render();
      });
    });
  }
}

function bindBackToGallery() {
  const btn = document.getElementById("backToGalleryBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    studyView = { mode: "gallery" };
    studyQueue = [];
    studyDirections = {};
    isFlipped = false;
    render();
  });
}

function renderManage() {
  const container = document.getElementById("tabContent");
  if (manageView.mode === "detail") {
    renderDeckDetail(container, manageView.deckId);
  } else {
    renderDeckList(container);
  }
}

function renderDeckList(container) {
  const today = todayStr(0);

  container.innerHTML = `
    <div class="add-form">
      <h3>Нова колода</h3>
      <div class="field">
        <label>Назва колоди</label>
        <input type="text" id="newDeckName" placeholder="напр. Дієслова, Подорожі, Їжа" />
      </div>
      <button class="primary-btn" id="addDeckBtn">Створити колоду</button>
    </div>

    <div class="deck-list">
      ${
        decks.length === 0
          ? `<p class="empty-list">Поки що немає жодної колоди. Створи першу!</p>`
          : decks
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((d) => {
                const deckCards = cards.filter((c) => c.deckId === d.id);
                const deckDue = deckCards.filter((c) => c.dueDate <= today).length;
                return `
                <div class="deck-card" data-id="${d.id}">
                  <div class="deck-card-main">
                    <div class="deck-card-name">${escapeHtml(d.name)}</div>
                    <div class="deck-card-meta">${deckCards.length} карток · ${deckDue} на сьогодні</div>
                  </div>
                  <div class="deck-card-actions">
                    <button class="open-deck-btn" data-id="${d.id}">Відкрити</button>
                    <button class="delete-btn" data-id="${d.id}">Видалити</button>
                  </div>
                </div>`;
              })
              .join("")
      }
    </div>

    <div class="backup-section">
      <h3>Перенесення між пристроями</h3>
      <p class="bulk-hint">
        Вивантаж дані з цього пристрою у файл — і імпортуй його на іншому
        (наприклад, на телефоні), щоб не вводити все заново.
      </p>
      <div class="backup-actions">
        <button class="secondary-btn" id="exportBtn">⬇ Експортувати дані</button>
        <button class="secondary-btn" id="importBtn">⬆ Імпортувати дані</button>
        <input type="file" id="importFileInput" accept="application/json" style="display:none" />
      </div>
    </div>
  `;

  document.getElementById("exportBtn").addEventListener("click", exportData);

  const importFileInput = document.getElementById("importFileInput");
  document.getElementById("importBtn").addEventListener("click", () => {
    importFileInput.click();
  });
  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files[0];
    if (file) importDataFromFile(file);
    importFileInput.value = "";
  });

  document.getElementById("addDeckBtn").addEventListener("click", () => {
    const nameInput = document.getElementById("newDeckName");
    const name = nameInput.value.trim();
    if (!name) return;
    const deck = makeDeck(name);
    decks.push(deck);
    saveDecks(decks);
    manageView = { mode: "detail", deckId: deck.id };
    render();
  });

  container.querySelectorAll(".open-deck-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      manageView = { mode: "detail", deckId: btn.dataset.id };
      render();
    });
  });

  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const deckId = btn.dataset.id;
      const deck = decks.find((d) => d.id === deckId);
      const cardCount = cards.filter((c) => c.deckId === deckId).length;
      const confirmed = confirm(
        `Видалити колоду «${deck?.name}»? Це також видалить усі ${cardCount} карток у ній.`
      );
      if (!confirmed) return;

      decks = decks.filter((d) => d.id !== deckId);
      cards = cards.filter((c) => c.deckId !== deckId);
      saveDecks(decks);
      saveCards(cards);

      // Якщо саме цю колоду проходили в сесії навчання — повертаємось до галереї
      if (studyView.mode === "session" && studyView.deckId === deckId) {
        studyView = { mode: "gallery" };
      }
      studyQueue = [];
      studyDirections = {};
      render();
    });
  });
}

function renderDeckDetail(container, deckId) {
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) {
    manageView = { mode: "list" };
    renderManage();
    return;
  }

  const deckCards = cards.filter((c) => c.deckId === deckId);

  const singleFormHtml = `
    <h3>Додати слово у «${escapeHtml(deck.name)}»</h3>
    <div class="field">
      <label>Іспанською</label>
      <input type="text" id="newFront" placeholder="напр. el perro" />
    </div>
    <div class="field">
      <label>Переклад</label>
      <input type="text" id="newBack" placeholder="напр. собака" />
    </div>
    <div class="field">
      <label>Приклад речення (необов'язково)</label>
      <input type="text" id="newExample" placeholder="напр. Tengo un perro." />
    </div>
    <button class="primary-btn" id="addCardBtn">Додати картку</button>
  `;

  const bulkFormHtml = `
    <h3>Масовий імпорт у «${escapeHtml(deck.name)}»</h3>
    <p class="bulk-hint">
      По одному слову на рядок, у форматі:<br />
      <code>іспанською | переклад | приклад (необов'язково)</code>
    </p>
    <div class="field">
      <textarea id="bulkInput" rows="8" placeholder="el perro | собака | Tengo un perro.
la mesa | стіл
comer | їсти | Me gusta comer paella."></textarea>
    </div>
    <button class="primary-btn" id="bulkImportBtn">Імпортувати картки</button>
  `;

  container.innerHTML = `
    <button class="back-btn" id="backToDecksBtn">← Усі колоди</button>

    <div class="add-form">
      <div class="subtabs">
        <button class="subtab-btn ${addSubTab === "single" ? "active" : ""}" data-subtab="single">Одна картка</button>
        <button class="subtab-btn ${addSubTab === "bulk" ? "active" : ""}" data-subtab="bulk">Масовий імпорт</button>
      </div>
      ${addSubTab === "single" ? singleFormHtml : bulkFormHtml}
    </div>

    <div class="card-list" id="cardList">
      ${
        deckCards.length === 0
          ? `<p class="empty-list">У цій колоді ще немає карток. Додай першу!</p>`
          : deckCards
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map(
                (c) => `
              <div class="card-row" data-id="${c.id}">
                <div class="card-row-main">
                  <div class="card-row-word">${escapeHtml(c.front)} — ${escapeHtml(c.back)}</div>
                  <div class="card-row-meta">Наступне повторення: ${c.dueDate}</div>
                </div>
                <button class="delete-btn" data-id="${c.id}">Видалити</button>
              </div>`
              )
              .join("")
      }
    </div>
  `;

  document.getElementById("backToDecksBtn").addEventListener("click", () => {
    manageView = { mode: "list" };
    render();
  });

  container.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      addSubTab = btn.dataset.subtab;
      render();
    });
  });

  if (addSubTab === "single") {
    document.getElementById("addCardBtn").addEventListener("click", () => {
      const front = document.getElementById("newFront").value.trim();
      const back = document.getElementById("newBack").value.trim();
      const example = document.getElementById("newExample").value.trim();
      if (!front || !back) return;
      cards.push(makeCard(front, back, example, deckId));
      saveCards(cards);
      render();
    });
  } else {
    document.getElementById("bulkImportBtn").addEventListener("click", () => {
      const raw = document.getElementById("bulkInput").value;
      const { parsed, skipped } = parseBulkText(raw);

      if (parsed.length === 0) {
        alert("Не вдалося розпізнати жодного рядка. Перевір формат: слово | переклад | приклад");
        return;
      }

      parsed.forEach((item) => {
        cards.push(makeCard(item.front, item.back, item.example, deckId));
      });
      saveCards(cards);

      addSubTab = "single";
      render();
      alert(
        skipped > 0
          ? `Додано ${parsed.length} карток. Пропущено ${skipped} рядків (не вистачало перекладу).`
          : `Додано ${parsed.length} карток.`
      );
    });
  }

  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      cards = cards.filter((c) => c.id !== id);
      saveCards(cards);
      studyQueue = studyQueue.filter((qid) => qid !== id);
      render();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function bindGlobalEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      isFlipped = false;
      render();
    });
  });
}

render();

// ---------- PWA: реєстрація service worker + кнопка встановлення ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById("installBanner");
  if (banner) banner.classList.add("visible");
});

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "installBtn" && deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
    document.getElementById("installBanner")?.classList.remove("visible");
  }
});
