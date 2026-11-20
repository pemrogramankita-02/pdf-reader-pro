(() => {
  const $ = id => document.getElementById(id);
  const R = {
    pdf: null, doc: null, page: 1, scale: 1, rotation: 0,
    mode: "continuous", rendering: false, renderToken: 0,
    bookmarked: false, pinch: null
  };
  let pdfjsReady = false;
  let resizeTimer = null;
  let pinchRenderTimer = null;

  function setupPDFjs() {
    if (!window.pdfjsLib) throw new Error("PDF.js belum termuat. Periksa koneksi internet lalu muat ulang.");
    if (!pdfjsReady) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      pdfjsReady = true;
    }
  }

  async function open(doc) {
    try {
      setupPDFjs();
      R.doc = doc;
      setToolbarHidden(false);
      R.page = doc.lastPage || 1;
      R.scale = 1;
      R.rotation = doc.rotation || 0;
      $("readerTitle").textContent = doc.name;
      $("readerMeta").textContent = "Membuka dokumen...";
      const data = await doc.blob.arrayBuffer();
      let task = pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true, verbosity: 0 });

      try {
        R.pdf = await task.promise;
      } catch (err) {
        if (err.name === "PasswordException" || String(err.message).toLowerCase().includes("password")) {
          const password = prompt("PDF dilindungi kata sandi. Masukkan kata sandi:");
          if (password === null) return;
          task = pdfjsLib.getDocument({ data: new Uint8Array(data), password, useSystemFonts: true, verbosity: 0 });
          R.pdf = await task.promise;
        } else {
          throw err;
        }
      }

      R.page = Math.min(R.page, R.pdf.numPages);
      doc.pages = R.pdf.numPages;
      doc.updatedAt = Date.now();
      await PDFDB.putDoc(doc);
      $("readerMeta").textContent = R.pdf.numPages + " halaman · " + (doc.size / 1024 / 1024).toFixed(1) + " MB";
      $("pageTotal").textContent = "/ " + R.pdf.numPages;
      $("pageInput").max = R.pdf.numPages;
      await render();
      await PDFDB.putHistory({ docId: doc.id, lastPage: R.page, openedAt: Date.now() });
    } catch (e) {
      console.error(e);
      toast(e.message || "Gagal membuka PDF.");
    }
  }

  async function render() {
    if (!R.pdf) return;
    const token = ++R.renderToken;
    R.rendering = true;
    const container = $("pdfPages");
    container.innerHTML = "";
    container.style.transform = "";
    const pages = R.mode === "single"
      ? [R.page]
      : Array.from({ length: R.pdf.numPages }, (_, i) => i + 1);

    $("pageInput").value = R.page;
    $("zoomLabel").textContent = Math.round(R.scale * 100) + "%";

    for (const n of pages) {
      if (token !== R.renderToken) return;
      const page = await R.pdf.getPage(n);
      if (token !== R.renderToken) return;

      const rotation = (page.rotate + R.rotation) % 360;
      const baseViewport = page.getViewport({ scale: 1, rotation });
      const maxWidth = Math.max(280, Math.min(window.innerWidth - 20, 900));
      const fitScale = Math.min(1, maxWidth / baseViewport.width);
      const finalViewport = page.getViewport({ scale: R.scale * fitScale, rotation });

      const wrap = document.createElement("div");
      wrap.className = "pdf-page";
      wrap.dataset.page = n;
      wrap.style.width = finalViewport.width + "px";
      wrap.style.height = finalViewport.height + "px";

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.max(1, Math.floor(finalViewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(finalViewport.height * dpr));
      canvas.style.width = finalViewport.width + "px";
      canvas.style.height = finalViewport.height + "px";

      wrap.append(canvas);
      container.append(wrap);

      await page.render({
        canvasContext: ctx,
        viewport: finalViewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
      }).promise;

      if (token !== R.renderToken) return;

      const textLayer = document.createElement("div");
      textLayer.className = "textLayer";
      textLayer.style.width = finalViewport.width + "px";
      textLayer.style.height = finalViewport.height + "px";
      wrap.append(textLayer);

      try {
        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
          textContent,
          container: textLayer,
          viewport: finalViewport,
          textDivs: []
        }).promise;
      } catch (textErr) {
        console.warn("Text layer tidak tersedia", textErr);
      }

      const saved = await PDFDB.annotations(R.doc.id);
      saved.filter(a => a.page === n && a.type === "note").forEach(a => {
        const note = document.createElement("div");
        note.textContent = a.text;
        note.style.cssText = "position:absolute;left:8%;top:12%;max-width:80%;padding:4px;background:#ffeb3b;color:#111;font-size:12px;";
        wrap.append(note);
      });
    }

    if (token !== R.renderToken) return;
    R.rendering = false;

    if (R.mode === "single") {
      $("pdfContainer").scrollTop = 0;
      $("pdfContainer").scrollLeft = 0;
    } else {
      const target = container.querySelector('[data-page="' + R.page + '"]');
      if (target) target.scrollIntoView({ block: "start" });
    }
    saveProgress();
  }

  async function saveProgress() {
    if (!R.doc) return;
    R.doc.lastPage = R.page;
    R.doc.rotation = R.rotation;
    R.doc.updatedAt = Date.now();
    await PDFDB.putDoc(R.doc);
    await PDFDB.putHistory({ docId: R.doc.id, lastPage: R.page, openedAt: Date.now() });
  }

  function go(n) {
    if (!R.pdf) return;
    R.page = Math.max(1, Math.min(R.pdf.numPages, n));
    if (R.mode === "single") {
      render();
    } else {
      const el = $("pdfPages").querySelector('[data-page="' + R.page + '"]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      $("pageInput").value = R.page;
      saveProgress();
    }
  }

  function setZoom(value, rerender = true) {
    R.scale = Math.max(0.5, Math.min(5, value));
    $("zoomLabel").textContent = Math.round(R.scale * 100) + "%";
    if (rerender) render();
  }

  $("prevBtn").onclick = () => go(R.page - 1);
  $("nextBtn").onclick = () => go(R.page + 1);
  $("pageInput").onchange = e => go(parseInt(e.target.value, 10) || 1);
  $("zoomInBtn").onclick = () => setZoom(R.scale + 0.2);
  $("zoomOutBtn").onclick = () => setZoom(R.scale - 0.2);
  $("rotateBtn").onclick = () => { R.rotation = (R.rotation + 90) % 360; render(); };

  $("fullscreenBtn").onclick = async () => {
    try {
      if (!document.fullscreenElement) await $("readerView").requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      toast("Mode layar penuh tidak didukung browser.");
    }
  };

  // Tombol pulih tetap tersedia saat toolbar disembunyikan.
  const restoreToolbarBtn = document.createElement("button");
  restoreToolbarBtn.id = "restoreToolbarBtn";
  restoreToolbarBtn.type = "button";
  restoreToolbarBtn.className = "restore-toolbar-btn";
  restoreToolbarBtn.textContent = "Tampilkan toolbar";
  restoreToolbarBtn.setAttribute("aria-label", "Kembalikan toolbar");
  restoreToolbarBtn.hidden = true;
  $("readerView").append(restoreToolbarBtn);

  function setToolbarHidden(hidden) {
    $("readerView").classList.toggle("toolbar-hidden", hidden);
    restoreToolbarBtn.hidden = !hidden;
    restoreToolbarBtn.setAttribute("aria-hidden", String(!hidden));
  }
  $("hideToolbarBtn").onclick = () => setToolbarHidden(true);
  restoreToolbarBtn.onclick = () => setToolbarHidden(false);
  $("modeBtn").onclick = () => {
    R.mode = R.mode === "continuous" ? "single" : "continuous";
    $("modeBtn").innerHTML = R.mode === "continuous" ? "▤ <span>Scroll</span>" : "▣ <span>Halaman</span>";
    render();
  };

  $("bookmarkBtn").onclick = async () => {
    const id = R.doc.id + "-" + R.page;
    const all = await PDFDB.bookmarks(R.doc.id);
    const old = all.find(x => x.page === R.page);
    if (old) {
      await PDFDB.deleteBookmark(old.id);
      toast("Bookmark dihapus.");
      $("bookmarkBtn").textContent = "☆";
    } else {
      await PDFDB.putBookmark({ id, docId: R.doc.id, page: R.page, createdAt: Date.now() });
      toast("Halaman ditandai.");
      $("bookmarkBtn").textContent = "★";
    }
  };

  $("bookmarksBtn").onclick = async () => {
    const list = await PDFDB.bookmarks(R.doc.id);
    $("readerMenu").hidden = true;
    if (!list.length) { alert("Belum ada bookmark."); return; }
    const chosen = prompt("Bookmark halaman: " + list.map(x => x.page).join(", ") + "\nMasukkan nomor halaman:");
    if (chosen) go(parseInt(chosen, 10));
  };

  $("contentsBtn").onclick = async () => {
    if (!R.pdf) return;
    const outline = await R.pdf.getOutline();
    if (!outline || !outline.length) { toast("Dokumen ini tidak memiliki daftar isi."); return; }
    const labels = [];
    function walk(items, depth = 0) {
      items.forEach(item => {
        labels.push("  ".repeat(depth) + item.title);
        if (item.items) walk(item.items, depth + 1);
      });
    }
    walk(outline);
    alert("DAFTAR ISI\n\n" + labels.join("\n") + "\n\nNavigasi melalui daftar isi PDF belum tersedia pada versi awal.");
  };

  $("readerMenu").addEventListener("click", e => {
    if (e.target.tagName === "BUTTON" && e.target.id !== "moreBtn") $("readerMenu").hidden = true;
  });
  $("closeDocBtn").onclick = () => {
    R.pdf = null;
    R.doc = null;
    window.showLibrary();
  };

  $("pdfContainer").addEventListener("scroll", () => {
    if (R.mode !== "continuous" || !R.pdf) return;
    const els = [...$("pdfPages").children];
    const top = $("pdfContainer").getBoundingClientRect().top;
    let best = R.page;
    let dist = Infinity;
    els.forEach(el => {
      const d = Math.abs(el.getBoundingClientRect().top - top);
      if (d < dist) { dist = d; best = Number(el.dataset.page); }
    });
    if (best !== R.page) {
      R.page = best;
      $("pageInput").value = best;
      clearTimeout(window._progressTimer);
      window._progressTimer = setTimeout(saveProgress, 500);
    }
  });

  /*
   * Gestur sentuh:
   * - Dua jari: pinch-to-zoom.
   * - Satu jari: geser dokumen secara manual.
   * Skala final dirender ulang setelah gestur selesai.
   */
  const pdfContainer = $("pdfContainer");
  let pinch = null;
  let pan = null;
  let lastTap = 0;

  const touchDistance = (a, b) =>
    Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

  pdfContainer.addEventListener("touchstart", event => {
    if (!R.pdf) return;

    if (event.touches.length === 2) {
      event.preventDefault();
      pan = null;
      const a = event.touches[0], b = event.touches[1];
      pinch = {
        startDistance: Math.max(1, touchDistance(a, b)),
        startScale: R.scale,
        previewScale: R.scale
      };
      return;
    }

    if (event.touches.length === 1 && !pinch) {
      const t = event.touches[0];
      pan = {
        x: t.clientX, y: t.clientY,
        scrollLeft: pdfContainer.scrollLeft,
        scrollTop: pdfContainer.scrollTop,
        moved: false
      };
    }
  }, { passive: false });

  pdfContainer.addEventListener("touchmove", event => {
    if (event.touches.length === 2 && pinch) {
      event.preventDefault();
      const distance = Math.max(1, touchDistance(event.touches[0], event.touches[1]));
      const ratio = distance / pinch.startDistance;
      const nextScale = Math.max(0.5, Math.min(5, pinch.startScale * ratio));
      pinch.previewScale = nextScale;
      $("pdfPages").style.transformOrigin = "top center";
      $("pdfPages").style.transform = "scale(" + (nextScale / pinch.startScale) + ")";
      $("zoomLabel").textContent = Math.round(nextScale * 100) + "%";
      return;
    }

    if (event.touches.length === 1 && pan && !pinch) {
      event.preventDefault();
      const t = event.touches[0];
      const dx = t.clientX - pan.x;
      const dy = t.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
      pdfContainer.scrollLeft = pan.scrollLeft - dx;
      pdfContainer.scrollTop = pan.scrollTop - dy;
    }
  }, { passive: false });

  function completePinch() {
    if (!pinch) return;
    const finalScale = pinch.previewScale;
    pinch = null;
    pan = null;
    if (Math.abs(finalScale - R.scale) < 0.01) {
      $("pdfPages").style.transform = "";
      $("zoomLabel").textContent = Math.round(R.scale * 100) + "%";
      return;
    }
    R.scale = finalScale;
    render();
  }

  pdfContainer.addEventListener("touchend", event => {
    if (pinch && event.touches.length < 2) {
      completePinch();
      return;
    }

    if (pan && event.touches.length === 0) {
      const wasMoved = pan.moved;
      pan = null;
      if (wasMoved) return;

      const now = Date.now();
      if (now - lastTap < 300) {
        setZoom(R.scale < 1.5 ? 2 : 1);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
  }, { passive: false });

  pdfContainer.addEventListener("touchcancel", () => {
    if (pinch) {
      pinch = null;
      $("pdfPages").style.transform = "";
      $("zoomLabel").textContent = Math.round(R.scale * 100) + "%";
    }
    pan = null;
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (R.pdf) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 250);
    }
  });

  window.PDFReader = { open, getState: () => R, render, setZoom };
})();
