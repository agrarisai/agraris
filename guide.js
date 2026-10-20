// ============================================
// Agraris — guide page (guide.html)
// ============================================
// "Copy checklist" copies the README checklist from Step 2. Falls back to
// selecting the text when the clipboard API is missing or refused, so the
// visitor can copy it by hand.

(function () {
  const btn = document.getElementById("copy-checklist-btn");
  const block = document.getElementById("readme-checklist");
  const msg = document.getElementById("copy-checklist-msg");
  if (!btn || !block || !msg) return;

  const defaultLabel = btn.textContent;

  function selectBlock() {
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function copied() {
    btn.textContent = "Copied";
    msg.textContent = "";
    setTimeout(() => {
      btn.textContent = defaultLabel;
    }, 2000);
  }

  function manual() {
    selectBlock();
    msg.textContent = "Selected. Press Ctrl+C (or Cmd+C) to copy.";
  }

  btn.addEventListener("click", () => {
    const text = block.textContent;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      manual();
      return;
    }
    navigator.clipboard.writeText(text).then(copied, manual);
  });
})();
