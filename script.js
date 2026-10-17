"use strict";

// 연습에 사용할 5개 문장: 시작할 때마다 무작위로 한 문장을 선택합니다.
const SENTENCES = [
  "오늘의 작은 연습이 내일의 큰 실력이 됩니다.",
  "천천히 정확하게 입력하면 속도는 자연스럽게 따라옵니다.",
  "새로운 배움은 언제나 한 글자에서 시작됩니다.",
  "꾸준한 노력은 생각보다 멀리 우리를 데려갑니다.",
  "포기하지 않고 도전하는 마음이 가장 큰 힘입니다."
];

const STORAGE_KEY = "hangulTypingRecordsV1";
const MAX_RECORDS = 5;

const elements = {
  target: document.getElementById("targetText"),
  input: document.getElementById("typingInput"),
  feedback: document.getElementById("inputFeedback"),
  progressBar: document.getElementById("progressBar"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  time: document.getElementById("timeValue"),
  cpm: document.getElementById("cpmValue"),
  accuracy: document.getElementById("accuracyValue"),
  resultPanel: document.getElementById("resultPanel"),
  resultSummary: document.getElementById("resultSummary"),
  restart: document.getElementById("restartButton"),
  recordList: document.getElementById("recordList"),
  storageFeedback: document.getElementById("storageFeedback")
};

// 유니코드 NFD에서 각각 한 글자로 표현되는 복합모음과 겹받침을
// 실제 구성 자모 단위로 한 번 더 나누어 타수를 셉니다.
const COMPOUND_JAMO = {
  "ᅪ": ["ᅩ", "ᅡ"], "ᅫ": ["ᅩ", "ᅢ"], "ᅬ": ["ᅩ", "ᅵ"],
  "ᅯ": ["ᅮ", "ᅥ"], "ᅰ": ["ᅮ", "ᅦ"], "ᅱ": ["ᅮ", "ᅵ"], "ᅴ": ["ᅳ", "ᅵ"],
  "ᆪ": ["ᆨ", "ᆺ"], "ᆬ": ["ᆫ", "ᆽ"], "ᆭ": ["ᆫ", "ᇂ"],
  "ᆰ": ["ᆯ", "ᆨ"], "ᆱ": ["ᆯ", "ᆷ"], "ᆲ": ["ᆯ", "ᆸ"],
  "ᆳ": ["ᆯ", "ᆺ"], "ᆴ": ["ᆯ", "ᇀ"], "ᆵ": ["ᆯ", "ᇁ"],
  "ᆶ": ["ᆯ", "ᇂ"], "ᆹ": ["ᆸ", "ᆺ"]
};

// 글자 → 자모 배열. 공백과 문장부호는 각각 1타로 취급합니다.
function toJamoUnits(text) {
  const units = [];
  for (const char of text.normalize("NFD")) {
    const split = COMPOUND_JAMO[char];
    if (split) units.push(...split);
    else units.push(char);
  }
  return units;
}

function countStrokes(text) {
  return toJamoUnits(text).length;
}

// 빠른 붙여넣기 등으로 수치가 매우 클 때는 화면에 맞게 축약 표시합니다.
// 저장되는 CPM 및 완료 결과의 계산 값은 원래 숫자를 그대로 사용합니다.
function formatCpm(value) {
  if (!Number.isFinite(value)) return "0";
  return value >= 10000
    ? new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)
    : value.toLocaleString("ko-KR");
}

// 자모 단위로 동일한 위치가 일치하는 정도를 계산합니다.
function matchingStrokes(typedChar, expectedChar) {
  const typedUnits = toJamoUnits(typedChar);
  const expectedUnits = toJamoUnits(expectedChar);
  return typedUnits.reduce((total, unit, index) => total + (unit === expectedUnits[index] ? 1 : 0), 0);
}

let round = null;
let previousSentenceIndex = -1;

function selectRandomSentence() {
  let index;
  do {
    index = Math.floor(Math.random() * SENTENCES.length);
  } while (SENTENCES.length > 1 && index === previousSentenceIndex);
  previousSentenceIndex = index;
  return SENTENCES[index];
}

function elapsedMs() {
  if (round.startedAt === null) return 0;
  return round.endedAt === null ? performance.now() - round.startedAt : round.endedAt - round.startedAt;
}

function getAccuracy() {
  return round.attempted === 0 ? null : Math.min(100, (round.matched / round.attempted) * 100);
}

// 변경된 입력 부분만 '새 입력 시도'로 기록합니다.
// 백스페이스로 지운 글자는 다시 세지 않고, 이후 새로 입력한 글자는 셉니다.
function collectCommittedInput(currentValue) {
  if (currentValue === round.committedValue) return;

  const before = Array.from(round.committedValue);
  const after = Array.from(currentValue);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const inserted = after.slice(prefix, after.length - suffix);
  const expected = Array.from(round.sentence);
  inserted.forEach((char, index) => {
    round.attempted += countStrokes(char);
    round.matched += matchingStrokes(char, expected[prefix + index] ?? "");
  });
  round.committedValue = currentValue;
}

// 한글이 조합되는 동안에도 제시 문장 표시를 갱신하되,
// 조합 중간의 ㄱ → 가 → 각 등을 입력 오류로 중복 집계하지 않습니다.
function drawTarget(value) {
  const typedChars = Array.from(value);
  const expectedChars = Array.from(round.sentence);
  const fragment = document.createDocumentFragment();

  expectedChars.forEach((char, index) => {
    const span = document.createElement("span");
    span.className = "target-char";
    if (index < typedChars.length) {
      span.classList.add(typedChars[index] === char ? "correct" : "incorrect");
    } else if (index === typedChars.length && !round.finished) {
      span.classList.add("cursor");
    }
    span.textContent = char;
    fragment.appendChild(span);
  });
  elements.target.replaceChildren(fragment);
}

function refreshMetrics() {
  const ms = elapsedMs();
  const typedText = elements.input.value.normalize("NFC");
  const strokeCount = countStrokes(round.finished ? round.sentence : typedText);
  const cpm = ms > 0 ? Math.round(strokeCount * 60000 / ms) : 0;
  const accuracy = getAccuracy();

  elements.time.textContent = (ms / 1000).toFixed(1);
  elements.cpm.textContent = formatCpm(cpm);
  elements.cpm.title = `${cpm.toLocaleString("ko-KR")} CPM`;
  elements.accuracy.textContent = accuracy === null ? "—" : accuracy.toFixed(1);
}

function drawGame(value) {
  drawTarget(value);

  const typedChars = Array.from(value);
  const expectedChars = Array.from(round.sentence);
  const completed = Math.min(typedChars.length, expectedChars.length);
  const percent = Math.round((completed / expectedChars.length) * 100);
  const wrong = typedChars.some((char, index) => char !== expectedChars[index]);

  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = `${percent}%`;
  elements.progressBar.setAttribute("aria-valuenow", String(percent));
  elements.feedback.classList.toggle("has-error", wrong && !round.finished);
  elements.feedback.classList.toggle("is-finished", round.finished);

  if (round.finished) {
    elements.feedback.textContent = "완료! 결과가 최근 기록에 저장되었습니다.";
  } else if (wrong) {
    elements.feedback.textContent = "다른 글자가 있어요. 빨간색 글자를 확인해 주세요.";
  } else if (round.startedAt === null) {
    elements.feedback.textContent = "준비 완료 · 입력을 시작하면 타이머가 작동합니다.";
  } else if (round.isComposing) {
    elements.feedback.textContent = "한글을 조합하는 중이에요. 계속 입력하세요!";
  } else {
    elements.feedback.textContent = "좋아요! 그대로 이어서 입력해 보세요.";
  }
  refreshMetrics();
}

// 첫 입력 시 시작하고, 고정 주기로 화면에 시간을 보여줍니다.
function startTimer() {
  if (round.startedAt !== null) return;
  round.startedAt = performance.now();
  round.timerId = window.setInterval(refreshMetrics, 100);
}

function loadRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record) =>
      record && typeof record.sentence === "string" &&
      Number.isFinite(record.durationMs) && Number.isFinite(record.cpm) &&
      Number.isFinite(record.accuracy) && typeof record.savedAt === "string"
    ).slice(0, MAX_RECORDS);
  } catch (error) {
    // 개인정보 보호 설정 등으로 저장소에 접근할 수 없는 환경을 처리합니다.
    elements.storageFeedback.textContent = "이 브라우저에서는 이전 기록을 읽을 수 없습니다.";
    return [];
  }
}

function renderRecords() {
  const records = loadRecords();
  elements.recordList.replaceChildren();

  if (records.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-history";
    empty.innerHTML = '<span aria-hidden="true">⌨</span>아직 기록이 없어요.<br>첫 번째 문장을 완성해 보세요!';
    elements.recordList.appendChild(empty);
    return;
  }

  records.forEach((record, index) => {
    const item = document.createElement("li");
    item.className = "record-item";
    const top = document.createElement("div");
    top.className = "record-top";

    const number = document.createElement("span");
    number.className = "record-number";
    number.textContent = `#${index + 1}`;

    const date = document.createElement("time");
    date.className = "record-date";
    const saved = new Date(record.savedAt);
    date.textContent = Number.isNaN(saved.getTime())
      ? "날짜 확인 불가"
      : new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(saved);
    date.dateTime = record.savedAt;
    top.append(number, date);

    const sentence = document.createElement("p");
    sentence.className = "record-sentence";
    sentence.textContent = record.sentence;

    const metrics = document.createElement("div");
    metrics.className = "record-metrics";
    [
      `⏱ ${(record.durationMs / 1000).toFixed(1)}초`,
      `⌨ ${formatCpm(record.cpm)} CPM`,
      `✓ ${record.accuracy.toFixed(1)}%`
    ].forEach((text) => {
      const metric = document.createElement("strong");
      metric.textContent = text;
      metrics.appendChild(metric);
    });

    item.append(top, sentence, metrics);
    elements.recordList.appendChild(item);
  });
}

function saveRecord(record) {
  const updated = [record, ...loadRecords()].slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    elements.storageFeedback.textContent = "";
  } catch (error) {
    elements.storageFeedback.textContent = "저장 공간을 사용할 수 없어 이번 기록을 보관하지 못했습니다.";
  }
  renderRecords();
}

// 목표 문장과 완전히 일치할 때만 게임을 종료합니다.
function finishRound() {
  if (round.finished) return;
  round.endedAt = performance.now();
  round.finished = true;
  window.clearInterval(round.timerId);
  round.timerId = null;
  elements.input.disabled = true;

  const durationMs = elapsedMs();
  const cpm = durationMs > 0 ? Math.round(countStrokes(round.sentence) * 60000 / durationMs) : 0;
  const accuracy = getAccuracy() ?? 100;
  elements.resultSummary.textContent = `${(durationMs / 1000).toFixed(1)}초 · ${cpm.toLocaleString("ko-KR")} CPM · 정확도 ${accuracy.toFixed(1)}%`;
  elements.resultPanel.hidden = false;

  saveRecord({
    sentence: round.sentence,
    durationMs,
    cpm,
    accuracy,
    savedAt: new Date().toISOString()
  });
}

// IME 입력 처리의 중심은 input 이벤트입니다. composition 이벤트는
// 한글 조합 중인지 구별하는 보조 신호로만 사용합니다.
function onInput(event) {
  if (round.finished) return;
  const value = elements.input.value.normalize("NFC");

  if (round.startedAt === null && value.length > 0) startTimer();

  if (!round.isComposing && !event.isComposing) {
    collectCommittedInput(value);
    if (value === round.sentence) finishRound();
  }
  drawGame(value);
}

function onCompositionEnd() {
  if (round.finished) return;
  round.isComposing = false;
  const value = elements.input.value.normalize("NFC");
  collectCommittedInput(value);
  if (value === round.sentence) finishRound();
  drawGame(value);
}

function resetRound(shouldFocus = false) {
  if (round?.timerId !== null && round?.timerId !== undefined) {
    window.clearInterval(round.timerId);
  }

  round = {
    sentence: selectRandomSentence(),
    startedAt: null,
    endedAt: null,
    timerId: null,
    isComposing: false,
    finished: false,
    committedValue: "",
    attempted: 0,
    matched: 0
  };

  elements.input.disabled = false;
  elements.input.value = "";
  elements.resultPanel.hidden = true;
  elements.resultSummary.textContent = "";
  drawGame("");
  if (shouldFocus) elements.input.focus();
}

// IME 상태를 감지하되, 문자 비교와 타이머는 input 이벤트로 처리합니다.
elements.input.addEventListener("compositionstart", () => { round.isComposing = true; });
elements.input.addEventListener("compositionend", onCompositionEnd);
elements.input.addEventListener("input", onInput);
elements.restart.addEventListener("click", () => resetRound(true));

renderRecords();
resetRound();
