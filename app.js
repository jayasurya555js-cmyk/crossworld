"use strict";

/* ==========================================
   CROSSWORD CHALLENGE — SHARED ENGINE
   Loaded by every page (index/daily/create/shared.html).
   Page-specific logic lives in each page's own <script> instead.
========================================== */

/* ------------------------------------------
   CONSTANTS & DOM HELPER
------------------------------------------ */

const DEFAULT_SIZE = 5;   // size of old shared links and the DAILY_PUZZLE demo above

// "Create your own puzzle" always builds an 8x8 grid, so words can be
// up to 8 letters long and five words fit far more easily.
const CREATOR_SIZE = 8;
const MAX_CREATOR_WORDS = 8;

function $(id) {
  return document.getElementById(id);
}

/* ------------------------------------------
   DEMO / FALLBACK PUZZLE
   Used for the Home page preview, and as a last-resort fallback
   if the Daily page somehow ends up with no usable puzzles.
------------------------------------------ */

const DAILY_PUZZLE = {
  title: "Today's Crossword",
  size: 5,

  words: [
    { word: "APPLE", clue: "A fruit that can be red or green", row: 0, col: 0, direction: "across" },
    { word: "PLANT", clue: "A living thing that grows in soil", row: 0, col: 0, direction: "down" },
    { word: "LEMON", clue: "A yellow citrus fruit", row: 0, col: 4, direction: "down" },
    { word: "PEN", clue: "Something you write with", row: 2, col: 0, direction: "across" },
    { word: "EAT", clue: "What you do when you have food", row: 4, col: 0, direction: "across" }
  ]
};

/* ------------------------------------------
   TEXT HELPERS
------------------------------------------ */

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return String(minutes).padStart(2, "0") + ":" +
         String(secs).padStart(2, "0");
}

function setStatus(elementId, message, type = "success") {
  const element = $(elementId);

  if (!message) {
    element.className = "status-message";
    element.textContent = "";
    return;
  }

  element.className = "status-message show " + type;
  element.textContent = message;
}

function cleanWord(word) {
  return word.toUpperCase().replace(/[^A-Z]/g, "");
}

/* ------------------------------------------
   SHAREABLE LINK ENCODING
------------------------------------------ */

function encodePuzzle(puzzle) {
  // Compact wire format: each word is a short array instead of an
  // object with full key names, and the title/size are only
  // included when they aren't the default — this keeps shared links
  // noticeably shorter than a full JSON dump of the puzzle.
  const compact = {
    w: puzzle.words.map(item => [
      item.word,
      item.clue,
      item.row,
      item.col,
      item.direction === "down" ? "d" : "a"
    ])
  };

  if (puzzle.title && puzzle.title !== "Custom Crossword") {
    compact.t = puzzle.title;
  }

  // Older links never stored a size (they were always 5x5), so the
  // size is only written when it differs from that default.
  if (puzzle.size && puzzle.size !== DEFAULT_SIZE) {
    compact.s = puzzle.size;
  }

  return base64UrlEncode(JSON.stringify(compact));
}

function decodePuzzle(encoded) {
  try {
    const data = JSON.parse(base64UrlDecode(encoded));

    // Compact format: { w: [[word, clue, row, col, dir], ...], t?: title }
    if (data && Array.isArray(data.w)) {
      return {
        title: data.t || "Custom Crossword",
        size: Number.isInteger(data.s) ? data.s : DEFAULT_SIZE,
        words: data.w.map(([word, clue, row, col, dir]) => ({
          word,
          clue,
          row,
          col,
          direction: dir === "d" ? "down" : "across"
        }))
      };
    }

    // Legacy format from earlier links: a full, uncompressed puzzle
    // object. Still supported so old shared links keep working.
    if (data && Array.isArray(data.words)) {
      return data;
    }

    return null;
  } catch (error) {
    return null;
  }
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(encoded) {
  const base64 = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = base64 + "=".repeat(
    (4 - base64.length % 4) % 4
  );

  const binary = atob(padded);
  const bytes = Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------
   BUILD GRID
------------------------------------------ */

function createEmptyGrid(size = DEFAULT_SIZE) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      letter: "",
      number: null,
      black: true,
      across: null,
      down: null
    }))
  );
}

function buildGrid(puzzle) {
  const grid = createEmptyGrid(puzzle.size || DEFAULT_SIZE);

  puzzle.words.forEach((word, index) => {
    const text = cleanWord(word.word);
    const direction = word.direction;
    const row = word.row;
    const col = word.col;

    for (let i = 0; i < text.length; i++) {
      const r = row + (direction === "down" ? i : 0);
      const c = col + (direction === "across" ? i : 0);

      if (
        r < 0 ||
        c < 0 ||
        r >= grid.length ||
        c >= grid.length
      ) continue;

      const cell = grid[r][c];

      cell.black = false;
      cell.letter = text[i];

      if (direction === "across") {
        cell.across = index;
      } else {
        cell.down = index;
      }
    }
  });

  let clueNumber = 1;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      const cell = grid[r][c];

      if (cell.black) continue;

      const leftCell = c > 0 ? grid[r][c - 1] : null;
      const upCell = r > 0 ? grid[r - 1][c] : null;

      // A cell starts an across word if there's no cell to its left,
      // that cell is black, OR that cell simply isn't part of the
      // same across word — not just "isn't black". Two across words
      // can sit right next to each other with no black divider
      // between them (e.g. the left cell only belongs to a down
      // word), and that still counts as a new start.
      const startsAcross =
        cell.across !== null &&
        (!leftCell || leftCell.black || leftCell.across !== cell.across);

      const startsDown =
        cell.down !== null &&
        (!upCell || upCell.black || upCell.down !== cell.down);

      if (startsAcross || startsDown) {
        cell.number = clueNumber++;
      }
    }
  }

  return grid;
}

/* ------------------------------------------
   CROSSWORD GENERATOR
   Backtracking placement algorithm. generateCrossword(words, size)
   works for any grid size; the Creator uses 8x8, Daily uses 5-8.
   options.preferSpan asks for a layout that touches all four edges
   (used for the Daily puzzles so a 7x7 really looks like a 7x7).
------------------------------------------ */

function generateCrossword(words, size = DEFAULT_SIZE, options = {}) {

  const preferSpan = options.preferSpan === true;
  const nodeBudget = options.maxNodes || 60000;

  const items = words
    .map(item => ({
      word: cleanWord(item.word),
      clue: String(item.clue || "").trim()
    }))
    .sort((a, b) => b.word.length - a.word.length);

  if (items.length === 0) return null;

  if (items.some(item =>
    item.word.length < 2 ||
    item.word.length > size
  )) {
    return null;
  }

  const grid = Array.from({ length: size }, () => Array(size).fill(null));

  const dirGrid = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ across: false, down: false }))
  );

  const placements = [];
  const usedItems = new Set();

  function canPlace(word, row, col, direction) {

    const beforeR = row - (direction === "down" ? 1 : 0);
    const beforeC = col - (direction === "across" ? 1 : 0);

    if (
      beforeR >= 0 && beforeC >= 0 &&
      grid[beforeR][beforeC] !== null
    ) {
      return false;
    }

    const afterR = row + (direction === "down" ? word.length : 0);
    const afterC = col + (direction === "across" ? word.length : 0);

    if (
      afterR < size && afterC < size &&
      grid[afterR][afterC] !== null
    ) {
      return false;
    }

    for (let i = 0; i < word.length; i++) {

      const r = row + (direction === "down" ? i : 0);
      const c = col + (direction === "across" ? i : 0);

      if (r < 0 || c < 0 || r >= size || c >= size) {
        return false;
      }

      const existing = grid[r][c];

      if (existing !== null) {

        if (existing !== word[i]) return false;
        if (dirGrid[r][c][direction]) return false;

      } else {

        if (direction === "across") {
          if (
            (r > 0 && grid[r - 1][c] !== null) ||
            (r < size - 1 && grid[r + 1][c] !== null)
          ) {
            return false;
          }
        } else {
          if (
            (c > 0 && grid[r][c - 1] !== null) ||
            (c < size - 1 && grid[r][c + 1] !== null)
          ) {
            return false;
          }
        }
      }
    }

    return true;
  }

  function place(itemIndex, row, col, direction) {

    const word = items[itemIndex].word;
    const letterChanges = [];
    const dirChanges = [];

    for (let i = 0; i < word.length; i++) {

      const r = row + (direction === "down" ? i : 0);
      const c = col + (direction === "across" ? i : 0);

      if (grid[r][c] === null) {
        grid[r][c] = word[i];
        letterChanges.push([r, c]);
      }

      if (!dirGrid[r][c][direction]) {
        dirGrid[r][c][direction] = true;
        dirChanges.push([r, c]);
      }
    }

    placements.push({ itemIndex, row, col, direction });
    usedItems.add(itemIndex);

    return { letterChanges, dirChanges, direction, itemIndex };
  }

  function undo(changed) {

    changed.letterChanges.forEach(([r, c]) => {
      grid[r][c] = null;
    });

    changed.dirChanges.forEach(([r, c]) => {
      dirGrid[r][c][changed.direction] = false;
    });

    placements.pop();
    usedItems.delete(changed.itemIndex);
  }

  // Returns every legal spot for a word. `crosses` counts how many
  // existing letters the word would share.
  function findCandidates(itemIndex, requireCrossing) {

    const word = items[itemIndex].word;
    const candidates = [];

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {

        for (const direction of ["across", "down"]) {

          if (!canPlace(word, row, col, direction)) continue;

          let crosses = 0;

          for (let i = 0; i < word.length; i++) {
            const r = row + (direction === "down" ? i : 0);
            const c = col + (direction === "across" ? i : 0);
            if (grid[r][c] === word[i]) crosses++;
          }

          if (!requireCrossing || crosses > 0) {
            candidates.push({ itemIndex, row, col, direction, crosses });
          }
        }
      }
    }

    return candidates;
  }

  function coversWholeGrid() {

    let minR = size, maxR = -1, minC = size, maxC = -1;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === null) continue;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }

    return minR === 0 && minC === 0 &&
           maxR === size - 1 && maxC === size - 1;
  }

  function attempt(requireSpan) {

    let nodes = 0;
    let gaveUp = false;
    const visited = new Set();

    function stateKey() {
      return placements
        .map(p => `${p.itemIndex}:${p.row},${p.col},${p.direction[0]}`)
        .sort()
        .join("|");
    }

    function solve() {

      if (placements.length === items.length) {
        return !requireSpan || coversWholeGrid();
      }

      if (gaveUp) return false;

      if (++nodes > nodeBudget) {
        gaveUp = true;
        return false;
      }

      const key = stateKey();
      if (visited.has(key)) return false;
      visited.add(key);

      let candidates = [];

      if (placements.length === 0) {
        // Start with the longest word; every other word then has to
        // cross something that is already on the board.
        candidates = findCandidates(0, false);

        const center = (size - 1) / 2;

        candidates.sort((a, b) => {
          const da = Math.abs(a.row - center) + Math.abs(a.col - center);
          const db = Math.abs(b.row - center) + Math.abs(b.col - center);
          return da - db;
        });

      } else {

        for (let i = 0; i < items.length; i++) {
          if (usedItems.has(i)) continue;
          candidates.push(...findCandidates(i, true));
        }

        // Prefer spots that touch more letters, then longer words.
        candidates.sort((a, b) =>
          b.crosses - a.crosses ||
          items[b.itemIndex].word.length - items[a.itemIndex].word.length
        );
      }

      for (const candidate of candidates) {

        const changed = place(
          candidate.itemIndex,
          candidate.row,
          candidate.col,
          candidate.direction
        );

        if (solve()) return true;

        undo(changed);

        if (gaveUp) return false;
      }

      return false;
    }

    return solve();
  }

  let solved = false;

  if (preferSpan) solved = attempt(true);

  if (!solved) {
    // Reset the board (a failed attempt always undoes itself, but be safe).
    placements.length = 0;
    usedItems.clear();
    solved = attempt(false);
  }

  if (!solved) return null;

  // Centre the finished layout inside the grid so a small puzzle
  // doesn't sit in one corner.
  let minR = size, maxR = -1, minC = size, maxC = -1;

  placements.forEach(p => {
    const len = items[p.itemIndex].word.length;
    const endR = p.row + (p.direction === "down" ? len - 1 : 0);
    const endC = p.col + (p.direction === "across" ? len - 1 : 0);
    minR = Math.min(minR, p.row);
    minC = Math.min(minC, p.col);
    maxR = Math.max(maxR, endR);
    maxC = Math.max(maxC, endC);
  });

  const shiftR = Math.floor((size - (maxR - minR + 1)) / 2) - minR;
  const shiftC = Math.floor((size - (maxC - minC + 1)) / 2) - minC;

  const result = placements
    .map(p => ({
      word: items[p.itemIndex].word,
      clue: items[p.itemIndex].clue,
      row: p.row + shiftR,
      col: p.col + shiftC,
      direction: p.direction
    }))
    // Reading order keeps the Across/Down clue lists in number order.
    .sort((a, b) =>
      a.row - b.row ||
      a.col - b.col ||
      (a.direction === b.direction ? 0 : a.direction === "across" ? -1 : 1)
    );

  return {
    title: "Custom Crossword",
    size,
    words: result
  };
}

/* ------------------------------------------
   BOMBS IN BLOCKED CELLS
   Every blocked (black) cell holds a bomb. Tapping it sets it off
   inside that one cell, then a new bomb pops back in, ready again.
------------------------------------------ */

const BOMB_ART = `
<span class="bomb-art" aria-hidden="true">
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="48" cy="93" rx="24" ry="4" fill="#000" opacity="0.35"/>
    <circle cx="48" cy="62" r="30" fill="url(#bombBodyGrad)" stroke="#6b0a12" stroke-width="2"/>
    <path d="M22 74 L27 69 M25 78 L30 73" stroke="#7a0f18" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
    <path d="M70 70 L76 64 M68 76 L74 70" stroke="#7a0f18" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
    <ellipse cx="34" cy="47" rx="8" ry="4.5" transform="rotate(-35 34 47)" fill="#fff" opacity="0.35"/>
    <path d="M35 62 Q35 50 48 50 Q61 50 61 62 Q61 67 57 70 L57 76 L39 76 L39 70 Q35 67 35 62 Z" fill="#fff"/>
    <ellipse cx="42.5" cy="62" rx="4" ry="4.8" fill="#9b0f19"/>
    <ellipse cx="53.5" cy="62" rx="4" ry="4.8" fill="#9b0f19"/>
    <path d="M48 66 L45.5 71 L50.5 71 Z" fill="#9b0f19"/>
    <path d="M43.5 73 V76 M48 73 V76 M52.5 73 V76" stroke="#9b0f19" stroke-width="1.4"/>
    <ellipse cx="48" cy="34" rx="12" ry="5.5" fill="#3a3f47" stroke="#15171b" stroke-width="1.5"/>
    <ellipse cx="48" cy="33" rx="6.5" ry="2.6" fill="#0f1114"/>
    <path d="M48 33 Q54 22 66 20" fill="none" stroke="#f1f1f1" stroke-width="4" stroke-linecap="round"/>
    <path d="M48 33 Q54 22 66 20" fill="none" stroke="#8a8f98" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 5"/>
    <g class="bomb-flame">
      <path d="M67 20 C58 18 58 8 64 2 C64 8 69 8 71 4 C77 8 77 16 73 20 C71 23 69 24 67 20 Z" fill="#ff7a00"/>
      <path d="M67 19 C62 17 62 11 66 7 C67 10 70 10 71 8 C74 11 73 16 70 19 C69 21 68 21 67 19 Z" fill="#ffc21a"/>
      <path d="M67 18 C65 16 66 13 68 11 C69 13 70 14 69 17 C69 18 68 19 67 18 Z" fill="#fff6c8"/>
    </g>
    <g class="bomb-glint" fill="#ffe27a">
      <circle cx="76" cy="10" r="1.6"/>
      <circle cx="58" cy="6" r="1.3"/>
      <circle cx="79" cy="20" r="1.2"/>
    </g>
  </svg>
</span>
<span class="bomb-fx" aria-hidden="true">
  <i class="fx-flash"></i>
  <i class="fx-ring"></i>
  <i class="fx-ring two"></i>
  <i class="fx-smoke"></i>
  <i class="fx-spark" style="--a:0deg"></i>
  <i class="fx-spark" style="--a:45deg"></i>
  <i class="fx-spark" style="--a:90deg"></i>
  <i class="fx-spark" style="--a:135deg"></i>
  <i class="fx-spark" style="--a:180deg"></i>
  <i class="fx-spark" style="--a:225deg"></i>
  <i class="fx-spark" style="--a:270deg"></i>
  <i class="fx-spark" style="--a:315deg"></i>
</span>`;

function ensureBombDefs() {
  if (document.getElementById("bomb-defs")) return;

  const holder = document.createElement("div");

  holder.innerHTML = `
    <svg id="bomb-defs" width="0" height="0" aria-hidden="true"
         style="position:absolute;width:0;height:0;overflow:hidden">
      <defs>
        <radialGradient id="bombBodyGrad" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stop-color="#ff6a5c"/>
          <stop offset="55%" stop-color="#e0212c"/>
          <stop offset="100%" stop-color="#a80f1b"/>
        </radialGradient>
      </defs>
    </svg>`;

  document.body.appendChild(holder.firstElementChild);
}

function igniteBomb(cell) {
  if (cell.classList.contains("boom")) return;

  cell.classList.remove("return");
  cell.classList.add("boom");

  setTimeout(() => {
    cell.classList.remove("boom");
    cell.classList.add("return");

    setTimeout(() => cell.classList.remove("return"), 550);
  }, 1000);
}

function decorateBombCell(cell) {
  ensureBombDefs();

  cell.classList.add("bomb-cell");
  cell.tabIndex = -1;
  cell.setAttribute("aria-label", "Bomb. Tap to set it off.");

  // Desynchronise the bombs so they don't all wobble in step.
  cell.style.setProperty("--bd", `-${(Math.random() * 2.5).toFixed(2)}s`);

  cell.innerHTML = BOMB_ART;

  // Keep keyboard focus where it is so typing into the puzzle
  // (and the mobile keyboard) isn't interrupted.
  cell.addEventListener("mousedown", event => event.preventDefault());
  cell.addEventListener("click", () => igniteBomb(cell));
}

/* ------------------------------------------
   CROSSWORD GAME CLASS
------------------------------------------ */

class CrosswordGame {

  constructor(puzzle, gridElement, acrossElement, downElement, options = {}) {

    this.puzzle = puzzle;
    this.gridElement = gridElement;
    this.acrossElement = acrossElement;
    this.downElement = downElement;

    this.grid = buildGrid(puzzle);
    this.size = puzzle.size || DEFAULT_SIZE;

    this.answers = Array.from(
      { length: this.size },
      () => Array(this.size).fill("")
    );

    this.selectedRow = 0;
    this.selectedCol = 0;
    this.direction = "across";

    this.started = false;
    this.completed = false;

    this.incorrectCells = new Set();

    this.maxHints = 3;
    this.hintsUsed = 0;

    this.onProgress = options.onProgress || function() {};
    this.onHintChange = options.onHintChange || function() {};

    this.render();
    this.onHintChange(this.maxHints - this.hintsUsed, this.maxHints);
  }

  render() {
    this.renderGrid();
    this.renderClues();
    this.selectFirstOpenCell();
    this.updateProgress();
  }

  // Bigger grids often have a blocked top-left corner, so start on
  // the first cell that can actually be typed into.
  selectFirstOpenCell() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const cell = this.grid[r][c];

        if (cell.black) continue;

        this.direction = cell.across !== null ? "across" : "down";
        this.selectCell(r, c);
        return;
      }
    }
  }

  renderGrid() {
    this.gridElement.innerHTML = "";

    this.gridElement.style.gridTemplateColumns =
      `repeat(${this.size}, 1fr)`;
    this.gridElement.dataset.size = this.size;

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {

        const cell = this.grid[r][c];

        const button = document.createElement("button");
        button.type = "button";
        button.className = "cell";

        button.dataset.row = r;
        button.dataset.col = c;

        button.setAttribute(
          "aria-label",
          cell.black
            ? "Blocked cell"
            : `Row ${r + 1}, column ${c + 1}`
        );

        if (cell.black) {
          button.classList.add("black");
          decorateBombCell(button);
        } else {

          if (cell.number !== null) {
            const number = document.createElement("span");
            number.className = "cell-number";
            number.textContent = cell.number;
            button.appendChild(number);
          }

          const letter = document.createElement("span");
          letter.className = "cell-letter";
          letter.textContent = this.answers[r][c];

          button.appendChild(letter);

          button.addEventListener("click", () => {
            if (
              this.selectedRow === r &&
              this.selectedCol === c
            ) {
              this.toggleDirection();
            } else {
              this.selectCell(r, c);
            }

            this.focusInputCapture();
          });
        }

        this.gridElement.appendChild(button);
      }
    }

    this.refreshCellStyles();
  }

  refreshCellStyles() {
    const cells = this.gridElement.querySelectorAll(".cell");

    cells.forEach(cell => {
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);

      if (this.grid[r][c].black) return;

      const letter = cell.querySelector(".cell-letter");

      if (letter) {
        letter.textContent = this.answers[r][c];
      }

      cell.classList.remove(
        "selected",
        "word-selected",
        "correct",
        "incorrect"
      );

      const inWord = this.isInSelectedWord(r, c);

      if (inWord) {
        cell.classList.add("word-selected");
      }

      if (
        r === this.selectedRow &&
        c === this.selectedCol
      ) {
        cell.classList.add("selected");
      }

      if (this.incorrectCells.has(`${r},${c}`)) {
        cell.classList.add("incorrect");
      }
    });
  }

  isInSelectedWord(r, c) {
    const wordIndex = this.getSelectedWordIndex();

    if (wordIndex === null) return false;

    const word = this.puzzle.words[wordIndex];

    if (word.direction === "across") {
      return r === word.row &&
        c >= word.col &&
        c < word.col + word.word.length;
    }

    return c === word.col &&
      r >= word.row &&
      r < word.row + word.word.length;
  }

  getSelectedWordIndex() {
    const cell = this.grid[this.selectedRow][this.selectedCol];

    if (!cell || cell.black) return null;

    return this.direction === "across"
      ? cell.across
      : cell.down;
  }

  selectCell(r, c) {
    if (!this.grid[r] || !this.grid[r][c]) return;
    if (this.grid[r][c].black) return;

    this.selectedRow = r;
    this.selectedCol = c;

    this.refreshCellStyles();
    this.highlightActiveClue();
  }

  focusInputCapture() {
    const input = document.getElementById("key-capture");
    if (!input) return;

    input.value = "";

    // Only call focus() if it isn't already focused, to avoid
    // needlessly re-triggering the mobile keyboard on every tap.
    if (document.activeElement !== input) {
      input.focus({ preventScroll: true });
    }
  }

  toggleDirection() {
    const cell = this.grid[this.selectedRow][this.selectedCol];

    if (!cell) return;

    if (
      this.direction === "across" &&
      cell.down !== null
    ) {
      this.direction = "down";
    } else if (
      this.direction === "down" &&
      cell.across !== null
    ) {
      this.direction = "across";
    } else if (cell.across !== null) {
      this.direction = "across";
    } else if (cell.down !== null) {
      this.direction = "down";
    }

    this.refreshCellStyles();
    this.highlightActiveClue();
  }

  moveNext() {
    let r = this.selectedRow;
    let c = this.selectedCol;

    const delta = this.direction === "across"
      ? [0, 1]
      : [1, 0];

    for (let i = 0; i < this.size; i++) {
      r += delta[0];
      c += delta[1];

      if (
        r >= 0 &&
        c >= 0 &&
        r < this.size &&
        c < this.size &&
        !this.grid[r][c].black
      ) {
        this.selectCell(r, c);
        return;
      }
    }
  }

  movePrevious() {
    let r = this.selectedRow;
    let c = this.selectedCol;

    const delta = this.direction === "across"
      ? [0, -1]
      : [-1, 0];

    for (let i = 0; i < this.size; i++) {
      r += delta[0];
      c += delta[1];

      if (
        r >= 0 &&
        c >= 0 &&
        r < this.size &&
        c < this.size &&
        !this.grid[r][c].black
      ) {
        this.selectCell(r, c);
        return;
      }
    }
  }

  handleKey(key) {
    if (this.completed) return;

    if (key === "ArrowRight") {
      this.direction = "across";
      this.moveNext();
      return;
    }

    if (key === "ArrowLeft") {
      this.direction = "across";
      this.movePrevious();
      return;
    }

    if (key === "ArrowDown") {
      this.direction = "down";
      this.moveNext();
      return;
    }

    if (key === "ArrowUp") {
      this.direction = "down";
      this.movePrevious();
      return;
    }

    if (key === "Backspace") {
      const r = this.selectedRow;
      const c = this.selectedCol;

      if (this.answers[r][c]) {
        this.answers[r][c] = "";
        this.incorrectCells.delete(`${r},${c}`);
      } else {
        this.movePrevious();
        this.answers[this.selectedRow][this.selectedCol] = "";
        this.incorrectCells.delete(
          `${this.selectedRow},${this.selectedCol}`
        );
      }

      this.refreshCellStyles();
      this.updateProgress();
      return;
    }

    if (/^[a-zA-Z]$/.test(key)) {
      if (!this.started) this.started = true;

      this.answers[this.selectedRow][this.selectedCol] =
        key.toUpperCase();

      this.incorrectCells.delete(
        `${this.selectedRow},${this.selectedCol}`
      );

      this.refreshCellStyles();
      this.updateProgress();
      this.moveNext();
    }
  }

  renderClues() {
    this.acrossElement.innerHTML = "";
    this.downElement.innerHTML = "";

    this.puzzle.words.forEach((word, index) => {

      const cell = this.grid[word.row][word.col];

      const button = document.createElement("button");
      button.type = "button";
      button.className = "clue-item";
      button.dataset.wordIndex = index;

      const number = document.createElement("span");
      number.className = "clue-number";
      number.textContent = cell.number || "";

      const text = document.createElement("span");
      text.className = "clue-text";
      text.textContent = word.clue;

      button.append(number, text);

      button.addEventListener("click", () => {
        this.direction = word.direction;
        this.selectCell(word.row, word.col);
        this.focusInputCapture();
      });

      if (word.direction === "across") {
        this.acrossElement.appendChild(button);
      } else {
        this.downElement.appendChild(button);
      }
    });
  }

  highlightActiveClue() {
    const wordIndex = this.getSelectedWordIndex();

    const allClues = [
      ...this.acrossElement.querySelectorAll(".clue-item"),
      ...this.downElement.querySelectorAll(".clue-item")
    ];

    allClues.forEach(button => {
      const isActive =
        wordIndex !== null &&
        Number(button.dataset.wordIndex) === wordIndex;

      button.classList.toggle("active", isActive);
    });
  }

  updateProgress() {
    let filled = 0;
    let total = 0;

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (!this.grid[r][c].black) {
          total++;

          if (this.answers[r][c]) {
            filled++;
          }
        }
      }
    }

    this.onProgress(filled, total);

    // Note: completion is intentionally NOT auto-detected here.
    // The player must click Check to find out the puzzle is solved —
    // see checkAnswers() below, which is the only place that sets
    // this.completed.
  }

  isCorrect() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.grid[r][c].black) continue;

        if (
          this.answers[r][c] !== this.grid[r][c].letter
        ) {
          return false;
        }
      }
    }

    return true;
  }

  checkAnswers() {
    let filled = 0;
    let correct = 0;
    let total = 0;

    this.incorrectCells.clear();

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {

        if (this.grid[r][c].black) continue;

        total++;

        if (this.answers[r][c]) {
          filled++;

          if (
            this.answers[r][c] === this.grid[r][c].letter
          ) {
            correct++;
          } else {
            this.incorrectCells.add(`${r},${c}`);
          }
        }
      }
    }

    this.refreshCellStyles();

    if (filled === total && correct === total) {
      this.completed = true;
    }

    return { filled, correct, total };
  }

  revealHint() {
    if (this.hintsUsed >= this.maxHints) {
      return { used: false, hintsLeft: 0 };
    }

    let r = this.selectedRow;
    let c = this.selectedCol;

    // If the currently selected cell is already filled correctly,
    // find another empty or wrong cell instead so the hint always
    // does something visible, even right after using Check.
    if (
      !this.grid[r] ||
      !this.grid[r][c] ||
      this.grid[r][c].black ||
      this.answers[r][c] === this.grid[r][c].letter
    ) {
      const target = this.findHintTarget();

      if (!target) {
        return { used: false, hintsLeft: this.maxHints - this.hintsUsed };
      }

      r = target.row;
      c = target.col;
      this.selectCell(r, c);
    }

    this.answers[r][c] = this.grid[r][c].letter;
    this.incorrectCells.delete(`${r},${c}`);

    this.hintsUsed++;

    this.refreshCellStyles();
    this.updateProgress();

    const hintsLeft = this.maxHints - this.hintsUsed;
    this.onHintChange(hintsLeft, this.maxHints);

    return { used: true, hintsLeft };
  }

  findHintTarget() {
    // Prefer an unfinished cell within the currently selected word.
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.grid[r][c].black) continue;
        if (!this.isInSelectedWord(r, c)) continue;

        if (this.answers[r][c] !== this.grid[r][c].letter) {
          return { row: r, col: c };
        }
      }
    }

    // Otherwise, scan the whole grid for any unfinished cell.
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.grid[r][c].black) continue;

        if (this.answers[r][c] !== this.grid[r][c].letter) {
          return { row: r, col: c };
        }
      }
    }

    return null;
  }

  clear() {
    this.answers = Array.from(
      { length: this.size },
      () => Array(this.size).fill("")
    );

    this.incorrectCells.clear();
    this.completed = false;
    this.refreshCellStyles();
    this.updateProgress();
  }
}

// ------------------------------------------
// KEYBOARD INPUT (physical + mobile)
// Call this once per page with a function that returns whichever
// CrosswordGame instance is currently active on that page (there's
// only ever one per page now — dailyGame on daily.html, sharedGame
// on shared.html — unlike the old single-page version, which had to
// check which section was "active" inside one shared document).
//
// The hidden #key-capture input is focused whenever a grid cell or
// clue is tapped (see focusInputCapture() on CrosswordGame). That
// focus is what makes mobile browsers pop up their on-screen
// keyboard — plain <div>/<button> cells with only a document-level
// keydown listener never trigger it, since there's no real focused
// text field for the OS to attach a keyboard to.
// ------------------------------------------

function wireUpKeyboardInput(getActiveGame) {

  document.addEventListener("keydown", event => {
    if (event.target.matches("input, textarea")) return;

    const game = getActiveGame();
    if (!game) return;

    if (
      event.key.length === 1 ||
      event.key === "Backspace" ||
      event.key.startsWith("Arrow")
    ) {
      event.preventDefault();
      game.handleKey(event.key);
    }
  });

  const keyCaptureInput = $("key-capture");
  if (!keyCaptureInput) return;

  // Backspace and arrow keys are reliably reported by keydown, even
  // on mobile on-screen keyboards, so handle them here directly.
  keyCaptureInput.addEventListener("keydown", event => {
    const game = getActiveGame();
    if (!game) return;

    if (event.key === "Backspace" || event.key.startsWith("Arrow")) {
      event.preventDefault();
      game.handleKey(event.key);
      keyCaptureInput.value = "";
    }
  });

  // Letters are handled via the "input" event instead of keydown,
  // since virtual/IME keyboards don't always fire a usable keydown
  // for character keys, but always fire "input" once a character
  // actually lands in the field.
  keyCaptureInput.addEventListener("input", () => {
    const game = getActiveGame();
    const value = keyCaptureInput.value;

    keyCaptureInput.value = "";

    if (!game || !value) return;

    const letter = value[value.length - 1];

    if (/^[a-zA-Z]$/.test(letter)) {
      game.handleKey(letter);
    }
  });
}

// ------------------------------------------
// ANALYTICS & ADS
// Each page is now a real, separately-loaded document, so a normal
// Google Analytics pageview already fires on every visit — no more
// manual single-page-app tracking needed. This just adds a few
// meaningful custom events on top (solving a puzzle, creating one,
// sharing a link), and starts each AdSense ad unit exactly once.
// ------------------------------------------

function trackEvent(name, params) {
  if (typeof gtag !== "function") return;
  gtag("event", name, params || {});
}

function updateHintButton(buttonId, hintsLeft) {
  const button = $(buttonId);

  button.textContent = hintsLeft > 0
    ? `💡 Hint (${hintsLeft} left)`
    : "💡 No hints left";

  button.disabled = hintsLeft <= 0;
}

function initAds() {
  document.querySelectorAll("ins.adsbygoogle").forEach(ins => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (error) {
      // AdSense may be blocked (ad blocker) or not yet approved —
      // fail silently rather than break the page.
    }
  });
}
