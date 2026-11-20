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

  const pageNodes = new Map();
  const renderedPages = new Map();
  let pageObserver = null;
  const visiblePageNumbers = new Set();
  let renderQueue = [];
  let renderQueueRunning = false;
  let pageRatio = 1.414;
  const MAX_ACTIVE_CANVASES = 7;

  function pageFitScale(baseViewport) {
    const maxWidth = Math.max(280, Math.min(window.innerWidth - 20, 900));
    return Math.min(1, maxWidth / baseViewport.width);
  }

  function clearRenderedPage(n) {
    const wrap = pageNodes.get(n);
    if (!wrap) return;
    const canvas = wrap.querySelector("canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
    wrap.querySelector(".textLayer")?.remove();
    wrap.querySelectorAll(".pdf-note-overlay").forEach(el => el.remove());
    renderedPages.delete(n);
  }

  async function renderOnePage(n, token) {
    if (!R.pdf || token !== R.renderToken || renderedPages.has(n)) return;
    const wrap = pageNodes.get(n);
    if (!wrap) return;

    const page = await R.pdf.getPage(n);
    if (token !== R.renderToken || !wrap.isConnected) return;

    const rotation = (page.rotate + R.rotation) % 360;
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const fitScale = pageFitScale(baseViewport);
    const viewport = page.getViewport({ scale: R.scale * fitScale, rotation });

    wrap.style.width = viewport.width + "px";
    wrap.style.height = viewport.height + "px";
    wrap.dataset.rendering = "true";

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    wrap.append(canvas);

    try {
      await page.render({
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
      }).promise;
      if (token !== R.renderToken || !wrap.isConnected) {
        canvas.width = 0; canvas.height = 0; return;
      }

      const textLayer = document.createElement("div");
      textLayer.className = "textLayer";
      textLayer.style.width = viewport.width + "px";
      textLayer.style.height = viewport.height + "px";
      wrap.append(textLayer);

      try {
        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
          textContent,
          container: textLayer,
          viewport,
          textDivs: []
        }).promise;
      } catch (textError) {
        console.warn("Text layer tidak tersedia:", textError);
      }

      const annotations = await PDFDB.annotations(R.doc.id);
      annotations.filter(a => a.page === n && a.type === "note").forEach(a => {
        const note = document.createElement("div");
        note.className = "pdf-note-overlay";
        note.textContent = a.text;
        note.style.cssText = "position:absolute;left:8%;top:12%;max-width:80%;padding:4px;background:#ffeb3b;color:#111;font-size:12px;z-index:4;";
        wrap.append(note);
      });

      wrap.dataset.rendering = "false";
      renderedPages.set(n, Date.now());
      trimRenderedPages(n);
    } catch (error) {
      canvas.remove();
      wrap.dataset.rendering = "false";
      console.error("Gagal merender halaman", n, error);
    }
  }

  function trimRenderedPages(currentPage) {
    if (renderedPages.size <= MAX_ACTIVE_CANVASES) return;
    const candidates = [...renderedPages.keys()]
      .filter(n => Math.abs(n - currentPage) > 2)
      .sort((a, b) => Math.abs(b - currentPage) - Math.abs(a - currentPage));
    while (renderedPages.size > MAX_ACTIVE_CANVASES && candidates.length) {
      clearRenderedPage(candidates.shift());
    }
  }

  function queueRender(n, token) {
    if (!R.pdf || token !== R.renderToken || renderedPages.has(n)) return;
    if (!renderQueue.some(item => item.n === n && item.token === token)) {
      renderQueue.push({ n, token });
    }
    renderQueue.sort((a, b) => Math.abs(a.n - R.page) - Math.abs(b.n - R.page));
    pumpRenderQueue();
  }

  async function pumpRenderQueue() {
    if (renderQueueRunning) return;
    renderQueueRunning = true;
    try {
      while (renderQueue.length) {
        renderQueue.sort((a, b) => Math.abs(a.n - R.page) - Math.abs(b.n - R.page));
        const item = renderQueue.shift();
        if (item.token !== R.renderToken || !R.pdf) continue;
        // Do not spend time rendering pages that have moved far outside the reading window.
        if (R.mode === "continuous" && Math.abs(item.n - R.page) > 5) continue;
        if (renderedPages.has(item.n)) continue;
        await renderOnePage(item.n, item.token);
      }
    } finally {
      renderQueueRunning = false;
      if (renderQueue.length) pumpRenderQueue();
    }
  }

  async function render() {
    if (!R.pdf) return;
    const token = ++R.renderToken;
    R.rendering = true;
    const container = $("pdfPages");
    const scrollBox = $("pdfContainer");
    const previousPage = R.page;

    if (pageObserver) pageObserver.disconnect();
    renderQueue = [];
    pageNodes.clear();
    visiblePageNumbers.clear();
    renderedPages.clear();
    container.innerHTML = "";
    container.style.transform = "";

    $("pageInput").value = R.page;
    $("zoomLabel").textContent = Math.round(R.scale * 100) + "%";

    const pageCount = R.mode === "single" ? 1 : R.pdf.numPages;
    const firstPageNumber = R.mode === "single" ? R.page : 1;
    const firstPage = await R.pdf.getPage(firstPageNumber);
    if (token !== R.renderToken) return;

    const firstRotation = (firstPage.rotate + R.rotation) % 360;
    const firstBase = firstPage.getViewport({ scale: 1, rotation: firstRotation });
    pageRatio = firstBase.height / firstBase.width;
    const fit = pageFitScale(firstBase);
    const estimatedWidth = firstBase.width * fit * R.scale;
    const estimatedHeight = firstBase.height * fit * R.scale;

    for (let i = 0; i < pageCount; i++) {
      const n = R.mode === "single" ? R.page : i + 1;
      const holder = document.createElement("div");
      holder.className = "pdf-page pdf-page-placeholder";
      holder.dataset.page = n;
      holder.style.width = estimatedWidth + "px";
      holder.style.height = estimatedHeight + "px";
      holder.style.maxWidth = "none";
      pageNodes.set(n, holder);
      container.append(holder);
    }

    if (R.mode === "single") {
      scrollBox.scrollTop = 0;
      scrollBox.scrollLeft = 0;
      await queueRender(R.page, token);
    } else {
      pageObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const n = Number(entry.target.dataset.page);
          if (entry.isIntersecting) {
            visiblePageNumbers.add(n);
            queueRender(n, token);
          } else {
            visiblePageNumbers.delete(n);
            if (renderedPages.has(n) && Math.abs(n - R.page) > 3) {
              clearRenderedPage(n);
            }
          }
        });
      }, {
        root: scrollBox,
        rootMargin: "1200px 0px 1200px 0px",
        threshold: 0
      });

      pageNodes.forEach(node => pageObserver.observe(node));

      const target = pageNodes.get(previousPage);
      if (target) {
        target.scrollIntoView({ block: "start" });
        queueRender(previousPage, token);
        if (pageNodes.has(previousPage - 1)) queueRender(previousPage - 1, token);
        if (pageNodes.has(previousPage + 1)) queueRender(previousPage + 1, token);
      }
    }

    R.rendering = false;
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
      const el = pageNodes.get(R.page);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        const token = R.renderToken;
        queueRender(R.page, token);
        if (pageNodes.has(R.page - 1)) queueRender(R.page - 1, token);
        if (pageNodes.has(R.page + 1)) queueRender(R.page + 1, token);
      }
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

  let scrollFramePending = false;
  $("pdfContainer").addEventListener("scroll", () => {
    if (R.mode !== "continuous" || !R.pdf || scrollFramePending) return;
    scrollFramePending = true;
    requestAnimationFrame(() => {
      scrollFramePending = false;
      const boxTop = $("pdfContainer").getBoundingClientRect().top;
      let best = R.page;
      let bestDistance = Infinity;
      visiblePageNumbers.forEach(n => {
        const el = pageNodes.get(n);
        if (!el) return;
        const distance = Math.abs(el.getBoundingClientRect().top - boxTop);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = n;
        }
      });
      if (best !== R.page) {
        R.page = best;
        $("pageInput").value = best;
        // Keep only queued work near the current viewport.
        renderQueue = renderQueue.filter(item =>
          item.token === R.renderToken && Math.abs(item.n - R.page) <= 5
        );
        // Prioritize the current page and its immediate neighbors.
        [R.page, R.page - 1, R.page + 1, R.page - 2, R.page + 2].forEach(n => {
          if (pageNodes.has(n) && !renderedPages.has(n)) queueRender(n, R.renderToken);
        });
        clearTimeout(window._progressTimer);
        window._progressTimer = setTimeout(saveProgress, 700);
      }
    });
  }, { passive: true });

  /*
   * Gestur sentuh:
   * - Satu jari menggunakan native scrolling browser (momentum/inertia).
   * - Dua jari menggunakan pinch zoom khusus aplikasi.
   */
  const pdfContainer = $("pdfContainer");
  let pinch = null;
  let lastTap = 0;

  const touchDistance = (a, b) =>
    Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

  pdfContainer.addEventListener("touchstart", event => {
    if (!R.pdf || event.touches.length !== 2) return;
    const a = event.touches[0], b = event.touches[1];
    pinch = {
      startDistance: Math.max(1, touchDistance(a, b)),
      startScale: R.scale,
      previewScale: R.scale
    };
  }, { passive: true });

  pdfContainer.addEventListener("touchmove", event => {
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const distance = Math.max(1, touchDistance(event.touches[0], event.touches[1]));
    const ratio = distance / pinch.startDistance;
    const nextScale = Math.max(0.5, Math.min(5, pinch.startScale * ratio));
    pinch.previewScale = nextScale;
    $("pdfPages").style.transformOrigin = "top center";
    $("pdfPages").style.transform = "scale(" + (nextScale / pinch.startScale) + ")";
    $("zoomLabel").textContent = Math.round(nextScale * 100) + "%";
  }, { passive: false });

  function completePinch() {
    if (!pinch) return;
    const finalScale = pinch.previewScale;
    pinch = null;
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
    if (event.changedTouches.length !== 1) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      setZoom(R.scale < 1.5 ? 2 : 1);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }, { passive: true });

  pdfContainer.addEventListener("touchcancel", () => {
    if (pinch) {
      pinch = null;
      $("pdfPages").style.transform = "";
      $("zoomLabel").textContent = Math.round(R.scale * 100) + "%";
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (R.pdf) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 250);
    }
  });

  window.PDFReader = { open, getState: () => R, render, setZoom };
})();
