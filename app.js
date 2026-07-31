/* =========================================================
   Español SRS — простий особистий тренажер з інтервальним
   повторенням (спрощений алгоритм SM-2, як в Anki).

   Дані зберігаються в localStorage браузера — тобто прямо
   на твоєму пристрої, офлайн, без жодного сервера.
   ========================================================= */

const STORAGE_KEY = "espanol_srs_cards_v1";
const DECKS_KEY = "espanol_srs_decks_v1";
const META_KEY = "espanol_srs_meta_v1";

// ---------- Початкова колода (щоб було з чим одразу вчитися) ----------
const SEED_DECK_ID = "seed-deck-a1";

const SEED_CARDS = [
  ["hola", "привіт", "¡Hola! ¿Cómo estás?"],
  ["gracias", "дякую", "Muchas gracias por tu ayuda."],
  ["por favor", "будь ласка", "Un café, por favor."],
  ["buenos días", "доброго ранку", "Buenos días, ¿qué tal?"],
  ["el agua", "вода", "Necesito un vaso de agua."],
  ["la comida", "їжа", "La comida está lista."],
  ["el amigo / la amiga", "друг / подруга", "Es mi mejor amigo."],
  ["la casa", "дім", "Vivo en una casa pequeña."],
  ["el trabajo", "робота", "Mañana tengo mucho trabajo."],
  ["comer", "їсти", "Me gusta comer paella."],
  ["hablar", "говорити", "¿Hablas español?"],
  ["el tiempo", "час / погода", "No tengo tiempo hoy."],
  ["la familia", "сім'я", "Mi familia es grande."],
  ["el libro", "книга", "Estoy leyendo un libro interesante."],
  ["viajar", "подорожувати", "Quiero viajar a España."],
  ["la ciudad", "місто", "Madrid es una ciudad hermosa."],
];

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
function loadDecks() {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (!raw) throw new Error("no decks yet");
    return JSON.parse(raw);
  } catch (e) {
    const seeded = [{ id: SEED_DECK_ID, name: "Основи (A1)", createdAt: Date.now() }];
    saveDecks(seeded);
    return seeded;
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
    loaded = SEED_CARDS.map((c) => makeCard(c[0], c[1], c[2], SEED_DECK_ID));
    saveCards(loaded);
    return loaded;
  }

  // Міграція: якщо картки збережені ще до появи колод (немає deckId),
  // прив'язуємо їх до першої наявної колоди, щоб нічого не загубилось.
  const needsMigration = loaded.some((c) => !c.deckId);
  if (needsMigration) {
    const decks = loadDecks();
    const fallbackDeckId = decks[0]?.id || SEED_DECK_ID;
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
let studyDeckId = "all"; // "all" або id конкретної колоди
let studyQueue = [];
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

function refreshQueueIfNeeded() {
  if (studyQueue.length === 0) {
    studyQueue = dueCards(studyDeckId).map((c) => c.id);
    currentCardIndex = 0;
  }
}

// ---------- Рендер ----------
const app = document.getElementById("app");

function render() {
  const due = dueCards(studyDeckId);
  const scopedCards = cardsInScope(studyDeckId);
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
  refreshQueueIfNeeded();

  const deckOptions = `
    <option value="all" ${studyDeckId === "all" ? "selected" : ""}>Усі колоди</option>
    ${decks
      .map((d) => `<option value="${d.id}" ${studyDeckId === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`)
      .join("")}
  `;

  const deckSelectorHtml = `
    <div class="deck-select-row">
      <label for="studyDeckSelect">Колода для навчання</label>
      <select id="studyDeckSelect">${deckOptions}</select>
    </div>
  `;

  if (studyQueue.length === 0) {
    container.innerHTML = `
      ${deckSelectorHtml}
      <div class="study-empty">
        <span class="big-emoji">✅</span>
        <h2>На сьогодні все повторено!</h2>
        <p>Повертайся завтра — або додай нові слова у вкладці «Колоди».</p>
      </div>
    `;
    bindStudyDeckSelect();
    return;
  }

  const cardId = studyQueue[currentCardIndex];
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    studyQueue.splice(currentCardIndex, 1);
    renderStudy();
    return;
  }

  container.innerHTML = `
    ${deckSelectorHtml}

    <div class="card-stage">
      <div class="flip-card ${isFlipped ? "flipped" : ""}" id="flipCard">
        <div class="card-face card-front">
          <span class="card-word">${escapeHtml(card.front)}</span>
          <span class="card-hint">Натисни, щоб перевернути</span>
        </div>
        <div class="card-face card-back">
          <span class="card-translation">${escapeHtml(card.back)}</span>
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

  bindStudyDeckSelect();

  document.getElementById("flipCard").addEventListener("click", () => {
    isFlipped = !isFlipped;
    renderStudy();
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

function bindStudyDeckSelect() {
  const select = document.getElementById("studyDeckSelect");
  if (!select) return;
  select.addEventListener("change", () => {
    studyDeckId = select.value;
    studyQueue = [];
    currentCardIndex = 0;
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
  `;

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
      studyQueue = [];
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
